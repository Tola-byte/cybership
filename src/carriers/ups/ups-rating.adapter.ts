// this has two tasks mainly.
// 1. to transform our rate req into what UPS expects
// 2. to transform the UPS response into our standard RateQuote format.

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import CircuitBreaker from "opossum";
import { CarrierAdapter } from "../carrier.interface";
import { RateQuote } from "../dtos/rate-quote.dto";
import { RateRequest } from "../dtos/rate-request.dto";
import { UpsAuthService } from "./ups-auth.service";
import {
  executeWithRetry,
  fetchWithTimeout,
  shouldRetryUPSRequest,
  UPSHttpStatusError,
  UPSMalformedResponseError,
} from "./ups-http-resilience";
import { validateRateRequest } from "./ups-rate-request.validation";
import { UPSRateRequest, UPSRateResponse } from "./ups.types";

@Injectable()
export class UpsRatingAdapter implements CarrierAdapter {
  private readonly circuitBreaker: CircuitBreaker<[RateRequest], RateQuote[]>;

  constructor(
    private readonly authService: UpsAuthService,
    private readonly configService: ConfigService,
  ) {
    this.circuitBreaker = new CircuitBreaker(
      this.executeUPSRateLookup.bind(this),
      {
        rollingCountTimeout: 30_000,
        rollingCountBuckets: 10,
        volumeThreshold: 5,
        errorThresholdPercentage: 100,
        resetTimeout: 30_000,
      },
    );
  }

  async getRates(request: RateRequest): Promise<RateQuote[]> {
    validateRateRequest(request);
    return this.circuitBreaker.fire(request);
  }

  private async executeUPSRateLookup(request: RateRequest): Promise<RateQuote[]> {
    const token = await this.authService.getAccessToken();
    const requestOption = request.serviceCode ? "rate" : "shop";
    const url = this.buildRatingUrl(requestOption);
    const body = this.buildUPSRequest(request);
    const timeoutMs = this.getHttpTimeoutMs();

    const response = await executeWithRetry(
      async () =>
        fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
          timeoutMs,
        ),
      shouldRetryUPSRequest,
    );

    if (!response.ok) {
      const bodyText = await response.text();
      throw new UPSHttpStatusError(response.status, response.statusText, bodyText);
    }

    const rawBodyText = await response.text();
    let payload: UPSRateResponse;
    try {
      payload = JSON.parse(rawBodyText) as UPSRateResponse;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new UPSMalformedResponseError(rawBodyText);
      }
      throw error;
    }

    return this.parseUPSResponse(payload);
  }

  private getHttpTimeoutMs(): number {
    const timeoutRaw = this.configService.get<string>("UPS_HTTP_TIMEOUT_MS");
    const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 5_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return 5_000;
    }
    return timeoutMs;
  }

  private buildRatingUrl(requestOption: "shop" | "rate"): string {
    const baseOverride = this.configService.get<string>("UPS_RATING_BASE_URL");
    if (baseOverride) {
      return `${baseOverride.replace(/\/$/, "")}/${requestOption}`;
    }

    const useSandbox =
      this.configService.get<string>("UPS_USE_SANDBOX") !== "false";
    const host = useSandbox ? "https://wwwcie.ups.com" : "https://onlinetools.ups.com";
    const version = this.configService.get<string>("UPS_RATING_VERSION") ?? "v2409";
    return `${host}/api/rating/${version}/${requestOption}`;
  }

  private buildUPSRequest(request: RateRequest): UPSRateRequest {
    const customerContext =
      this.configService.get<string>("UPS_CUSTOMER_CONTEXT") ?? "cybership-rate";
    const shipperNumber = this.configService.get<string>("UPS_SHIPPER_NUMBER");
    if (!shipperNumber) {
      throw new Error("Missing UPS_SHIPPER_NUMBER for rating request.");
    }

    const upsRequest: UPSRateRequest = {
      RateRequest: {
        Request: {
          TransactionReference: {
            CustomerContext: customerContext,
          },
        },
        Shipment: {
          Shipper: {
            ShipperNumber: shipperNumber,
            Address: {
              AddressLine: request.origin.street,
              City: request.origin.city,
              StateProvinceCode: request.origin.stateCode,
              PostalCode: request.origin.postalCode,
              CountryCode: request.origin.countryCode,
            },
          },
          ShipFrom: {
            Address: {
              AddressLine: request.origin.street,
              City: request.origin.city,
              StateProvinceCode: request.origin.stateCode,
              PostalCode: request.origin.postalCode,
              CountryCode: request.origin.countryCode,
            },
          },
          ShipTo: {
            Address: {
              AddressLine: request.destination.street,
              City: request.destination.city,
              StateProvinceCode: request.destination.stateCode,
              PostalCode: request.destination.postalCode,
              CountryCode: request.destination.countryCode,
            },
          },
          Package: {
            PackagingType: { Code: "02" },
            Dimensions: {
              UnitOfMeasurement: { Code: "IN" },
              Length: String(request.package.lengthIn),
              Width: String(request.package.widthIn),
              Height: String(request.package.heightIn),
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: "LBS" },
              Weight: String(request.package.weightLbs),
            },
          },
        },
      },
    };

    if (request.serviceCode) {
      upsRequest.RateRequest.Shipment.Service = { Code: request.serviceCode };
    }

    return upsRequest;
  }

  private parseUPSResponse(response: UPSRateResponse): RateQuote[] {
    const ratedShipment = response?.RateResponse?.RatedShipment;
    if (!ratedShipment) {
      return [];
    }

    const shipments = Array.isArray(ratedShipment)
      ? ratedShipment
      : [ratedShipment];

    return shipments.map((shipment) => {
      const estimatedDaysRaw =
        shipment.GuaranteedDelivery?.BusinessDaysInTransit;
      const estimatedDays = estimatedDaysRaw
        ? Number.parseInt(estimatedDaysRaw, 10)
        : undefined;

      return {
        carrier: "UPS",
        serviceCode: shipment.Service?.Code ?? "",
        serviceName: shipment.Service?.Description ?? shipment.Service?.Code ?? "Unknown",
        totalCharge: Number.parseFloat(shipment.TotalCharges?.MonetaryValue ?? "0"),
        currency: shipment.TotalCharges?.CurrencyCode ?? "USD",
        estimatedDays: Number.isFinite(estimatedDays) ? estimatedDays : undefined,
      };
    });
  }
}

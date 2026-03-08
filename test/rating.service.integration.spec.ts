import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { CarrierAdapter } from "../src/carriers/carrier.interface";
import { CARRIER_ADAPTERS } from "../src/carriers/carrier.tokens";
import { RateQuote } from "../src/carriers/dtos/rate-quote.dto";
import { RateRequest } from "../src/carriers/dtos/rate-request.dto";
import { UpsAuthService } from "../src/carriers/ups/ups-auth.service";
import { UpsRatingAdapter } from "../src/carriers/ups/ups-rating.adapter";
import { RatingService } from "../src/rating/rating.service";

type ConfigMap = Record<string, string>;

const baseConfig: ConfigMap = {
  UPS_CLIENT_ID: "test-client-id",
  UPS_CLIENT_SECRET: "test-client-secret",
  UPS_SHIPPER_NUMBER: "12345E",
  UPS_USE_SANDBOX: "true",
  UPS_HTTP_TIMEOUT_MS: "1000",
};

const tokenSuccessPayload = {
  access_token: "test-token-abc123",
  expires_in: "3600",
  token_type: "Bearer",
};

const rateSuccessPayload = {
  RateResponse: {
    RatedShipment: [
      {
        Service: { Code: "03", Description: "UPS Ground" },
        TotalCharges: { CurrencyCode: "USD", MonetaryValue: "12.50" },
        GuaranteedDelivery: { BusinessDaysInTransit: "3" },
      },
      {
        Service: { Code: "02", Description: "UPS 2nd Day Air" },
        TotalCharges: { CurrencyCode: "USD", MonetaryValue: "24.99" },
        GuaranteedDelivery: { BusinessDaysInTransit: "2" },
      },
    ],
  },
};

const rateRequestFixture: RateRequest = {
  origin: {
    street: "123 Main St",
    city: "Atlanta",
    stateCode: "GA",
    postalCode: "30301",
    countryCode: "US",
  },
  destination: {
    street: "456 Oak Ave",
    city: "Los Angeles",
    stateCode: "CA",
    postalCode: "90001",
    countryCode: "US",
  },
  package: {
    weightLbs: 5,
    lengthIn: 10,
    widthIn: 8,
    heightIn: 6,
  },
};

@Injectable()
class StaticSuccessAdapter implements CarrierAdapter {
  async getRates(): Promise<RateQuote[]> {
    return [
      {
        carrier: "STATIC",
        serviceCode: "FAST",
        serviceName: "Static Fast",
        totalCharge: 9.99,
        currency: "USD",
        estimatedDays: 1,
      },
    ];
  }
}

@Injectable()
class StaticFailingAdapter implements CarrierAdapter {
  async getRates(): Promise<RateQuote[]> {
    throw new Error("Static adapter failure");
  }
}

describe("RatingService Integration", () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function buildService(mode: "allSuccess" | "oneFails" | "allFail"): Promise<RatingService> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UpsAuthService,
        UpsRatingAdapter,
        StaticSuccessAdapter,
        StaticFailingAdapter,
        RatingService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): string | undefined => baseConfig[key],
          },
        },
        {
          provide: CARRIER_ADAPTERS,
          useFactory: (
            ups: UpsRatingAdapter,
            successAdapter: StaticSuccessAdapter,
            failingAdapter: StaticFailingAdapter,
          ): CarrierAdapter[] => {
            if (mode === "allSuccess") {
              return [ups, successAdapter];
            }
            if (mode === "oneFails") {
              return [ups, failingAdapter];
            }
            return [ups, failingAdapter];
          },
          inject: [UpsRatingAdapter, StaticSuccessAdapter, StaticFailingAdapter],
        },
      ],
    }).compile();

    return moduleRef.get(RatingService);
  }

  function mockUpsRateSuccess(): void {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(tokenSuccessPayload), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rateSuccessPayload), { status: 200 }),
      );
  }

  it("returns combined quotes when all adapters succeed", async () => {
    mockUpsRateSuccess();
    const service = await buildService("allSuccess");

    const result = await service.getRates(rateRequestFixture);

    expect(result).toEqual([
      {
        carrier: "UPS",
        serviceCode: "03",
        serviceName: "UPS Ground",
        totalCharge: 12.5,
        currency: "USD",
        estimatedDays: 3,
      },
      {
        carrier: "UPS",
        serviceCode: "02",
        serviceName: "UPS 2nd Day Air",
        totalCharge: 24.99,
        currency: "USD",
        estimatedDays: 2,
      },
      {
        carrier: "STATIC",
        serviceCode: "FAST",
        serviceName: "Static Fast",
        totalCharge: 9.99,
        currency: "USD",
        estimatedDays: 1,
      },
    ]);
  });

  it("returns partial quotes when one adapter fails", async () => {
    mockUpsRateSuccess();
    const service = await buildService("oneFails");

    const result = await service.getRates(rateRequestFixture);

    expect(result).toEqual([
      {
        carrier: "UPS",
        serviceCode: "03",
        serviceName: "UPS Ground",
        totalCharge: 12.5,
        currency: "USD",
        estimatedDays: 3,
      },
      {
        carrier: "UPS",
        serviceCode: "02",
        serviceName: "UPS 2nd Day Air",
        totalCharge: 24.99,
        currency: "USD",
        estimatedDays: 2,
      },
    ]);
  });

  it("returns empty array when all adapters fail", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "unauthorized" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const service = await buildService("allFail");
    const result = await service.getRates(rateRequestFixture);

    expect(result).toEqual([]);
  });
});

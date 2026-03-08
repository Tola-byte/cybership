import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { RateRequest } from "../src/carriers/dtos/rate-request.dto";
import { UpsAuthService } from "../src/carriers/ups/ups-auth.service";
import { UpsRatingAdapter } from "../src/carriers/ups/ups-rating.adapter";
import {
  UPSHttpStatusError,
  UPSRequestTimeoutError,
} from "../src/carriers/ups/ups-http-resilience";
import { ValidationError } from "../src/carriers/ups/ups-rate-request.validation";

type ConfigMap = Record<string, string>;

const baseConfig: ConfigMap = {
  UPS_CLIENT_ID: "test-client-id",
  UPS_CLIENT_SECRET: "test-client-secret",
  UPS_SHIPPER_NUMBER: "12345E",
  UPS_USE_SANDBOX: "true",
  UPS_HTTP_TIMEOUT_MS: "5",
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

const rateError400Payload = {
  response: {
    errors: [
      { code: "111210", message: "The requested service is unavailable" },
    ],
  },
};

describe("UpsRatingAdapter Integration", () => {
  let adapter: UpsRatingAdapter;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(async () => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UpsAuthService,
        UpsRatingAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): string | undefined => baseConfig[key],
          },
        },
      ],
    }).compile();

    adapter = moduleRef.get(UpsRatingAdapter);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockTokenThenRateResponse(rateResponse: Response): void {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(tokenSuccessPayload), { status: 200 }),
      )
      .mockResolvedValueOnce(rateResponse);
  }

  it("builds correct UPS request body from RateRequest — assert exact JSON shape", async () => {
    mockTokenThenRateResponse(
      new Response(JSON.stringify(rateSuccessPayload), { status: 200 }),
    );

    await adapter.getRates(rateRequestFixture);

    const secondCall = fetchMock.mock.calls[1];
    const requestInit = secondCall[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));

    expect(body).toEqual({
      RateRequest: {
        Request: {
          TransactionReference: {
            CustomerContext: "cybership-rate",
          },
        },
        Shipment: {
          Shipper: {
            ShipperNumber: "12345E",
            Address: {
              AddressLine: "123 Main St",
              City: "Atlanta",
              StateProvinceCode: "GA",
              PostalCode: "30301",
              CountryCode: "US",
            },
          },
          ShipFrom: {
            Address: {
              AddressLine: "123 Main St",
              City: "Atlanta",
              StateProvinceCode: "GA",
              PostalCode: "30301",
              CountryCode: "US",
            },
          },
          ShipTo: {
            Address: {
              AddressLine: "456 Oak Ave",
              City: "Los Angeles",
              StateProvinceCode: "CA",
              PostalCode: "90001",
              CountryCode: "US",
            },
          },
          Package: {
            PackagingType: { Code: "02" },
            Dimensions: {
              UnitOfMeasurement: { Code: "IN" },
              Length: "10",
              Width: "8",
              Height: "6",
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: "LBS" },
              Weight: "5",
            },
          },
        },
      },
    });
  });

  it("calls /shop endpoint when serviceCode is absent", async () => {
    mockTokenThenRateResponse(
      new Response(JSON.stringify(rateSuccessPayload), { status: 200 }),
    );

    await adapter.getRates(rateRequestFixture);

    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain("/shop");
  });

  it("calls /rate endpoint when serviceCode is present", async () => {
    mockTokenThenRateResponse(
      new Response(JSON.stringify(rateSuccessPayload), { status: 200 }),
    );

    await adapter.getRates({ ...rateRequestFixture, serviceCode: "03" });

    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    const requestInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));

    expect(secondCallUrl).toContain("/rate");
    expect(body.RateRequest.Shipment.Service).toEqual({ Code: "03" });
  });

  it("parses successful UPS rate response into RateQuote[]", async () => {
    mockTokenThenRateResponse(
      new Response(JSON.stringify(rateSuccessPayload), { status: 200 }),
    );

    const result = await adapter.getRates(rateRequestFixture);

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

  it("handles RatedShipment as single object vs array", async () => {
    const singlePayload = {
      RateResponse: {
        RatedShipment: {
          Service: { Code: "03", Description: "UPS Ground" },
          TotalCharges: { CurrencyCode: "USD", MonetaryValue: "12.50" },
          GuaranteedDelivery: { BusinessDaysInTransit: "3" },
        },
      },
    };

    mockTokenThenRateResponse(new Response(JSON.stringify(singlePayload), { status: 200 }));

    const result = await adapter.getRates(rateRequestFixture);

    expect(result).toEqual([
      {
        carrier: "UPS",
        serviceCode: "03",
        serviceName: "UPS Ground",
        totalCharge: 12.5,
        currency: "USD",
        estimatedDays: 3,
      },
    ]);
  });

  it("throws UPSHttpStatusError on 400 response", async () => {
    mockTokenThenRateResponse(
      new Response(JSON.stringify(rateError400Payload), {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    const action = adapter.getRates(rateRequestFixture);

    await expect(action).rejects.toBeInstanceOf(UPSHttpStatusError);
    await expect(action).rejects.toMatchObject({
      status: 400,
      statusText: "Bad Request",
    });
  });

  it("throws UPSHttpStatusError on 500 response", async () => {
    mockTokenThenRateResponse(
      new Response(JSON.stringify({ message: "upstream error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const action = adapter.getRates(rateRequestFixture);

    await expect(action).rejects.toBeInstanceOf(UPSHttpStatusError);
    await expect(action).rejects.toMatchObject({ status: 500 });
  });

  it("throws on malformed JSON response", async () => {
    mockTokenThenRateResponse(
      new Response("{invalid-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(adapter.getRates(rateRequestFixture)).rejects.toThrow();
  });

  it("throws UPSRequestTimeoutError on request timeout", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(tokenSuccessPayload), { status: 200 }),
    );
    fetchMock.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const abortError = new Error("Aborted");
              abortError.name = "AbortError";
              reject(abortError);
            },
            { once: true },
          );
        }),
    );

    await expect(adapter.getRates(rateRequestFixture)).rejects.toBeInstanceOf(
      UPSRequestTimeoutError,
    );
  });

  it("throws ValidationError and makes no HTTP calls for invalid request", async () => {
    const invalidRequest: RateRequest = {
      ...rateRequestFixture,
      origin: {
        ...rateRequestFixture.origin,
        street: "",
      },
      package: {
        ...rateRequestFixture.package,
        weightLbs: 0,
      },
      serviceCode: "   ",
    };

    await expect(adapter.getRates(invalidRequest)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

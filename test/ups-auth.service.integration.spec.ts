import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { UpsAuthService } from "../src/carriers/ups/ups-auth.service";
import { UPSHttpStatusError } from "../src/carriers/ups/ups-http-resilience";

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

describe("UpsAuthService Integration", () => {
  let service: UpsAuthService;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(async () => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UpsAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): string | undefined => baseConfig[key],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(UpsAuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("acquires token on first call and caches it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(tokenSuccessPayload), { status: 200 }),
    );

    const token = await service.getAccessToken();

    expect(token).toBe("test-token-abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses cached token on second call without fetching again", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(tokenSuccessPayload), { status: 200 }),
    );

    const first = await service.getAccessToken();
    const second = await service.getAccessToken();

    expect(first).toBe("test-token-abc123");
    expect(second).toBe("test-token-abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes token when within 60 seconds of expiry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "short-lived-token",
            expires_in: "30",
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "refreshed-token",
            expires_in: "3600",
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      );

    const first = await service.getAccessToken();
    const second = await service.getAccessToken();

    expect(first).toBe("short-lived-token");
    expect(second).toBe("refreshed-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws structured error when token endpoint returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "unauthorized" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const action = service.getAccessToken();

    await expect(action).rejects.toBeInstanceOf(UPSHttpStatusError);
    await expect(action).rejects.toMatchObject({
      status: 401,
      statusText: "Unauthorized",
    });
  });

  it("throws when access_token missing from response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          expires_in: "3600",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );

    await expect(service.getAccessToken()).rejects.toThrow(
      "UPS auth response is missing access_token or expires_in",
    );
  });
});

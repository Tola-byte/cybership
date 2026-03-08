import { Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import {
  executeWithRetry,
  fetchWithTimeout,
  shouldRetryUPSRequest,
  UPSHttpStatusError,
} from "./ups-http-resilience";

@Injectable()
export class UpsAuthService {
  private cachedToken: string | null = null
  private tokenExpiresAt = 0
  private fetchPromise: Promise<void> | null = null
  constructor(private readonly configService: ConfigService) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now()
    const timeLeft = this.tokenExpiresAt - now
    if (this.cachedToken && timeLeft > 60_000) {
      return this.cachedToken
    }
    if (!this.fetchPromise) {
    this.fetchPromise = this.fetchToken().finally(() => {
      this.fetchPromise = null 
    })
  }
    await this.fetchPromise
    return this.cachedToken!
  }

  private async fetchToken(): Promise<void> {
    const clientId = this.configService.get<string>("UPS_CLIENT_ID")
    const clientSecret = this.configService.get<string>("UPS_CLIENT_SECRET")
    if (!clientId || !clientSecret) {
      throw new Error(
        "Missing UPS credentials. Set UPS_CLIENT_ID and UPS_CLIENT_SECRET.",
      )
    }

    const tokenUrl =
      this.configService.get<string>("UPS_OAUTH_TOKEN_URL") ??
      this.getDefaultTokenUrl()
    const timeoutMs = this.getHttpTimeoutMs();

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    )

    const response = await executeWithRetry(
      async () =>
        fetchWithTimeout(
          tokenUrl,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
          },
          timeoutMs,
        ),
      shouldRetryUPSRequest,
    );

    if (!response.ok) {
      const bodyText = await response.text()
      throw new UPSHttpStatusError(response.status, response.statusText, bodyText)
    }

    const payload = (await response.json()) as {
      access_token?: string
      expires_in?: number | string
    }

    if (!payload.access_token || payload.expires_in === undefined) {
      throw new Error("UPS auth response is missing access_token or expires_in")
    }

    const expiresInSeconds = Number(payload.expires_in)
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error(`Invalid UPS expires_in value: ${payload.expires_in}`)
    }

    this.cachedToken = payload.access_token
    this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000
  }

  private getHttpTimeoutMs(): number {
    const timeoutRaw = this.configService.get<string>("UPS_HTTP_TIMEOUT_MS");
    const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 5_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return 5_000;
    }
    return timeoutMs;
  }

  private getDefaultTokenUrl(): string {
    const useSandbox = this.configService.get<string>("UPS_USE_SANDBOX") !== "false";
    return useSandbox
      ? "https://wwwcie.ups.com/security/v1/oauth/token"
      : "https://onlinetools.ups.com/security/v1/oauth/token"
  }
}

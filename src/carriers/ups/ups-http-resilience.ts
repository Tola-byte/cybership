const RETRY_DELAYS_MS = [100, 200, 400] as const;

export class UPSHttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly bodyText: string,
  ) {
    super(`UPS request failed (${status} ${statusText}): ${bodyText}`);
    this.name = "UPSHttpStatusError";
  }
}

export class UPSRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`UPS request timed out after ${timeoutMs}ms`);
    this.name = "UPSRequestTimeoutError";
  }
}

export class UPSMalformedResponseError extends Error {
  constructor(readonly rawResponseText: string) {
    super("UPS response body is not valid JSON.");
    this.name = "UPSMalformedResponseError";
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function shouldRetryUPSRequest(error: unknown): boolean {
  if (error instanceof UPSHttpStatusError) {
    return error.status === 503 || error.status === 429; // for rate limiting or service unavailable, we need to retry. 
    // Ideally we should retry for rate limiting.
  }

  if (error instanceof UPSRequestTimeoutError) {
    return true;
  }

  return error instanceof TypeError;
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !shouldRetry(error)) {
        throw error;
      }

      await sleep(RETRY_DELAYS_MS[attempt]);
      attempt += 1;
    }
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new UPSRequestTimeoutError(timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

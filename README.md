```markdown
# Carrier Integration Service

A NestJS backend service that wraps the UPS Rating API behind a 
normalized internal contract.

The core idea: callers send a carrier-agnostic RateRequest and get 
back RateQuote[] without knowing anything about UPS's request format, 
auth flow, or response shape. Adding FedEx later means creating a new 
adapter folder — nothing else changes.

---

## How to run

```bash
npm install
cp .env.example .env        # fill in UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_SHIPPER_NUMBER
npm run start:dev
```

Run tests:
```bash
npm test
```

---

## Design decisions

**Adapter pattern**
RatingService depends only on the CarrierAdapter interface injected 
via CARRIER_ADAPTERS token. It has no UPS imports, no UPS types, 
no UPS anything. Adding FedEx means creating src/carriers/fedex/, 
implementing CarrierAdapter, registering it as a provider. 
Zero changes to RatingService.

**Auth as a separate service**
UpsAuthService owns the entire OAuth lifecycle — token acquisition, 
in-memory caching, expiry checking, and refresh. UpsRatingAdapter 
just calls getAccessToken() and gets a valid token back. 
The two concerns don't bleed into each other.

One subtle thing worth noting which I implemented: if getAccessToken() is called 
simultaneously by multiple requests with an expired token, 
a promise lock ensures only one fetch goes out — the rest 
wait on the same promise rather than triggering parallel 
token requests.

**Circuit breaker placement**
The breaker wraps the entire UPS lookup execution in UpsRatingAdapter, 
not just the HTTP call. That means auth failures, mapping errors, 
and network failures all contribute to tripping the circuit — 
not just the rating endpoint itself.

**Validation before external calls**
RateRequest is validated with Zod before any HTTP call is made. 
Bad input throws a structured ValidationError immediately 
and never reaches UPS.

---

## Resilience

| Pattern | Where | Why |
|---|---|---|
| Circuit breaker (opossum) | ups-rating.adapter.ts | Stop hammering UPS when it's down |
| Retry + exponential backoff | ups-http-resilience.ts | Handle transient 503s and timeouts |
| Request timeout (AbortController) | ups-http-resilience.ts | Never let a hung connection hold resources |
| Promise lock on token fetch | ups-auth.service.ts | Prevent parallel token requests on expiry |
| Zod input validation | ups-rate-request.validation.ts | Reject bad input before any external call |

Current backpressure posture: partial. Circuit breaker + timeout + retry reduce upstream pressure and fail fast, but full backpressure controls (inbound rate limiting, bounded queues/load shedding, and per-carrier concurrency caps) are not yet implemented.

Retries only fire on transient failures — 503, 429, timeout, network error. 
400s and 401s are not retried because retrying your own mistake 
doesn't help.

---

## What I'd add given more time

**Redis token cache** — current in-memory cache breaks with multiple 
service instances. Each instance fetches its own token. 
Redis as a shared cache fixes that.

**Correlation IDs** — pass a request-scoped ID through every outbound 
call so failures can be traced across logs without grepping 
by timestamp.

**Explicit backpressure controls** — add inbound rate limiting, per-carrier
concurrency limits, and load shedding to protect the service under burst traffic.

**Metrics per circuit state** — emit counters on circuit open/close, 
retry attempts, and timeout counts. Right now failures are logged 
but not measurable.

---

## Project structure

```
src/
  carriers/
    carrier.interface.ts        # the contract every carrier implements
    carriers.module.ts
    dto/                        # clean internal types (RateRequest, RateQuote)
    ups/
      ups-auth.service.ts       # OAuth token lifecycle
      ups-rating.adapter.ts     # implements CarrierAdapter for UPS
      ups-http-resilience.ts    # timeout, retry, error classes
      ups-rate-request.validation.ts  # Zod schema
      ups.types.ts              # raw UPS request/response shapes
  rating/
    rating.service.ts           # orchestrates adapters, knows nothing about UPS
```
```

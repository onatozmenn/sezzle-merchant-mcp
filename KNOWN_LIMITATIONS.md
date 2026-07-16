# Known Limitations and API Verification Status

## Maturity

This project is an unofficial, experimental integration. Production-oriented and security-focused design does not mean production readiness. The deterministic business logic, permission model, mutation guards, transports, persistence, and mocked API integration are tested. The Sezzle API adapter has not been validated with real merchant sandbox credentials.

Do not enable production financial mutations until [the sandbox validation checklist](docs/SANDBOX_VALIDATION.md) has been completed and reviewed.

## Verification categories

### Verified against official documentation

The following contracts were compared with <https://docs.sezzle.com/openapi.yaml> on 2026-07-16. This verifies documented shape, not live behavior.

| Operation            | Method and path                             | Auth                        | Request and response                                            | Pagination or idempotency                                         |
| -------------------- | ------------------------------------------- | --------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Authenticate         | `POST /v2/authentication`                   | API keys in body; no bearer | `public_key`, `private_key`; token, expiry, merchant UUID       | No pagination; no idempotency                                     |
| Create session       | `POST /v2/session`                          | Bearer                      | Session/order/customer body; session and order metadata         | No documented idempotency; automatic retry disabled               |
| Get session          | `GET /v2/session/{session_uuid}`            | Bearer                      | Path UUID; session/order/tokenization metadata                  | Safe GET retry policy                                             |
| Get order            | `GET /v2/order/{order_uuid}`                | Bearer                      | Path UUID; order, authorization, capture/refund/release details | Safe GET retry policy; customer fields intentionally stripped     |
| Update reference     | `PATCH /v2/order/{order_uuid}`              | Bearer                      | `reference_id`; 204                                             | No documented idempotency; automatic retry disabled               |
| Delete checkout      | `DELETE /v2/order/{order_uuid}/checkout`    | Bearer                      | Path UUID; 204                                                  | No documented idempotency; automatic retry disabled               |
| Capture              | `POST /v2/order/{order_uuid}/capture`       | Bearer                      | `capture_amount` price; transaction UUID                        | `Sezzle-Request-Id` documented and used                           |
| Refund               | `POST /v2/order/{order_uuid}/refund`        | Bearer                      | Price body; transaction UUID                                    | `Sezzle-Request-Id` documented and used                           |
| Release              | `POST /v2/order/{order_uuid}/release`       | Bearer                      | Price body; transaction UUID                                    | `Sezzle-Request-Id` documented and used                           |
| Reauthorize          | `POST /v2/order/{order_uuid}/reauthorize`   | Bearer                      | Price body; new AUTH order and approval                         | `Sezzle-Request-Id` documented and used; HTTP 200 is not approval |
| Settlement summaries | `GET /v2/settlements/summaries`             | Bearer                      | Date, offset, currency query; JSON summaries                    | Up to 30 records; caller controls offset                          |
| Settlement details   | `GET /v2/settlements/details/{payout_uuid}` | Bearer                      | Payout UUID and optional metadata query; CSV                    | No pagination documented                                          |
| Order report         | `GET /v2/orders/report`                     | Bearer                      | Inclusive start/end dates; JSON rows                            | Maximum seven-day range; allowlisting required                    |
| Interest balance     | `GET /v2/interest/balance`                  | Bearer                      | Optional currency; four-decimal JSON balance                    | Enrollment required                                               |
| Interest activity    | `GET /v2/interest/activity`                 | Bearer                      | Date, offset, currency query; CSV                               | Up to 20 records; caller controls offset                          |
| List webhooks        | `GET /v2/webhooks`                          | Bearer                      | No body; subscription array                                     | No pagination documented                                          |
| Create webhook       | `POST /v2/webhooks`                         | Bearer                      | URL and event list; subscription UUID/links                     | No documented idempotency; automatic retry disabled               |
| Get webhook          | `GET /v2/webhooks/{webhooks_uuid}`          | Bearer                      | Path UUID; subscription                                         | Safe GET retry policy                                             |
| Update webhook       | `PATCH /v2/webhooks/{webhooks_uuid}`        | Bearer                      | Complete URL and event list; UUID/links                         | Event set is replaced; automatic retry disabled                   |
| Delete webhook       | `DELETE /v2/webhooks/{webhooks_uuid}`       | Bearer                      | Path UUID; 204                                                  | Irreversible; automatic retry disabled                            |
| Test webhook         | `POST /v2/webhooks/test`                    | Bearer                      | URL and documented event; 201                                   | No documented idempotency; automatic retry disabled               |

All money request objects use explicit ISO currency and integer `amount_in_cents`. V2 API errors are documented as arrays containing `code`, `message`, optional `location`, and `debug_uuid`; the adapter also accepts a single documented example object and normalizes both forms.

Webhook event names are restricted to the current documented set: `customer.tokenized`, `order.authorized`, `order.captured`, `order.refunded`, and the five documented dispute events. Signatures are documented as HMAC-SHA256 over the exact raw body using merchant signing material.

### Verified only with mock integration tests

- Bearer acquisition, caching, pre-expiry reacquisition, merchant UUID matching, and one 401 reacquisition.
- Request paths, methods, headers, query construction, timeout handling, `Retry-After`, and retry restrictions.
- Session/order response projection and customer-field stripping.
- Capture/refund/release/reauthorization request bodies and idempotency headers.
- Settlement JSON/CSV and interest CSV parsing using official-document-shaped fixtures.
- Webhook subscription requests, raw-body verification, duplicate delivery, and out-of-order timelines.
- Error normalization for documented mock status/body combinations.

### Requires real sandbox validation

- Authentication against current merchant sandbox credentials and observed expiry behavior.
- Session creation/retrieval, checkout completion, order retrieval, and all mutation state transitions.
- Actual capture, refund, release, and reauthorization responses, including rejected approval responses.
- Idempotency behavior after timeout or connection loss.
- Rate-limit status, headers, and retry timing.
- Merchant-specific minimum amounts, currencies, products, and authorization expiry settings.
- Settlement summary/detail payloads, order-report allowlisting, and interest-account enrollment.
- Webhook subscription lifecycle, signing material, signature header formatting, retries, duplicates, and delivery ordering.
- Exact production/sandbox credential mismatch errors.

### Not currently implemented

- Upcharge, because the official page marks it in development and unavailable for production.
- Tokenized-customer and virtual-card operations, which expand customer-data and PCI boundaries.
- Consumer account management, spending-limit prediction, underwriting/decline explanations, dashboard scraping, browser automation, and private mobile APIs.
- Multi-node shared state, native OAuth/OIDC, application-level database encryption, and automatic webhook retention.

## Documented ambiguities

- Authorization event examples use nested `amount`, while the `AuthorizationEvent` component uses flat `amount_in_cents` and `currency_code`. The adapter accepts only those two documented forms. Real sandbox validation must determine the observed form.
- Settlement summaries are documented as JSON floats. The adapter parses raw response text losslessly before conversion to integer minor units.
- Settlement details and interest activity are CSV rather than versioned JSON objects. Column drift will fail or require adapter updates.
- Sezzle documentation describes webhook HMAC signing with the merchant private key. The server binds signing material through `SEZZLE_WEBHOOK_SECRET` to isolate it operationally; sandbox validation must confirm the configured value and accepted header format.
- The documentation index links to `https://gateway.sezzle.com/v2api.yaml`, which returned 404 during audit. The published `https://docs.sezzle.com/openapi.yaml` was used.

## Operational limitations

- Streamable HTTP is stateless and uses a configured bearer token; deploy it behind TLS and organization authentication.
- SQLite is single-process storage and is not application-level encrypted. Verified raw webhook bodies may contain personal data.
- No live Sezzle API or webhook delivery was performed during implementation or pre-publication audit.

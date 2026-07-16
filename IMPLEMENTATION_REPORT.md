# SezzleOps MCP Implementation Report

Date: 2026-07-16

## Outcome

Implemented `sezzle-merchant-mcp`, an unofficial and experimental TypeScript MCP server named `sezzle-ops`. The design is production-oriented and security-focused, with mocked integration coverage. The Sezzle API adapter has not been validated with real merchant sandbox credentials and must not be treated as production-ready. The implementation uses the production MCP TypeScript SDK v1, Node.js 20+, Zod 4, native fetch, Vitest, ESLint, Prettier, Pino JSON logging, stdio, stateless Streamable HTTP, Docker, and memory/SQLite storage.

The repository prominently states:

> This project is unofficial and is not affiliated with, endorsed by, or maintained by Sezzle.

No Sezzle logos or partnership claims are included.

## Implemented capabilities

- Sandbox-first, read-only startup and explicit production configuration.
- Permission profiles that filter tools before MCP registration.
- In-memory bearer token acquisition, pre-expiry refresh, and one-time 401 reacquisition.
- Request correlation IDs, timeouts, bounded concurrency, `Retry-After`, and safe retry policy.
- Normalized errors without raw stack traces.
- Integer minor-unit money and `bigint` arithmetic.
- Lossless JSON and CSV decimal parsing for settlements and interest values.
- Expiring mutation previews bound to merchant, environment, target, request hash, and fresh state hash.
- Literal `confirm: true`, single-use previews, documented idempotency headers, and duplicate reservations.
- Redacted audit events for previews, successes, failures, rejections, and webhook ingestion.
- Deterministic settlement reconciliation, duplicate suppression, payout calculation, confidence, and evidence.
- HMAC-SHA256 verification over raw webhook bytes before JSON parsing.
- Idempotent webhook storage, correlation keys, occurrence-time timelines, and health diagnostics.
- Stable-code Integration Doctor findings and production go-live checklist.
- Secure support policy with PII-free order projection and merchant-reference ownership verification.
- Six MCP resources and five evidence-first prompts.
- Memory and durable SQLite storage with WAL, atomic reservation/consumption, row validation, and restrictive Unix file permissions.
- Non-root multi-stage Docker image and hardened Compose service.

## Tool inventory

Admin write mode was inspected after build and registers exactly 55 tools:

| Area                                                       |  Count |
| ---------------------------------------------------------- | -----: |
| Authentication, sessions, orders, and financial operations |     14 |
| Settlement and report API tools                            |      5 |
| Deterministic reconciliation                               |      7 |
| Webhook management and operations                          |     13 |
| Integration Doctor                                         |      9 |
| Support intelligence                                       |      5 |
| Audit inspection                                           |      2 |
| **Total**                                                  | **55** |

The complete runtime-derived names and profile behavior are documented in [docs/TOOL_INVENTORY.md](docs/TOOL_INVENTORY.md).

## Validation results

Verified locally with mocked API integration and no live Sezzle credentials. Local runtime and exact audit results are re-recorded during the pre-publication audit; the Node 20 container build does not constitute Sezzle sandbox validation.

| Check                           | Result                                  |
| ------------------------------- | --------------------------------------- |
| Test files                      | 22 passed                               |
| Tests                           | 93 passed                               |
| Core statement coverage         | 82.87%                                  |
| Core line coverage              | 85.38%                                  |
| Core function coverage          | 85.44%                                  |
| Core branch coverage            | 67.15%                                  |
| Strict TypeScript               | Passed                                  |
| ESLint                          | Passed with zero warnings               |
| Prettier                        | Passed                                  |
| Production TypeScript build     | Passed                                  |
| Docker Node 20 build            | Passed                                  |
| npm audit                       | 0 known vulnerabilities at install time |
| Full admin/write tool inventory | 55 tools                                |

Runtime-derived tool counts by profile:

| Profile    | Read-only mode | Write-enabled mode |
| ---------- | -------------: | -----------------: |
| `read`     |             18 |                 18 |
| `finance`  |             28 |                 35 |
| `webhooks` |              8 |                 13 |
| `support`  |              5 |                  5 |
| `admin`    |             43 |                 55 |

Full admin/write mode exposes 6 resources and 5 prompts. These counts are generated from runtime MCP discovery in [docs/TOOL_INVENTORY.md](docs/TOOL_INVENTORY.md), not manually maintained.

Coverage is enforced over deterministic, validation, security, and persistence core modules. Thin MCP registration and transport wiring are validated separately through protocol and integration tests so they do not distort the meaningful core metric.

Critical regression coverage includes:

- capture above authorization rejection;
- refund above remaining refundable amount rejection;
- literal confirmation and preview binding;
- read-only non-registration;
- integer-only money;
- retry/idempotency behavior;
- secret and PII redaction;
- settlement payout determinism;
- signature rejection before parsing;
- duplicate and out-of-order webhook handling;
- support ownership and action-evidence rules;
- production/sandbox and HTTP exposure barriers;
- SQLite restart durability;
- stdio registration and Streamable HTTP with the official client.

## Sezzle API source of truth

Implemented endpoints are present in <https://docs.sezzle.com/openapi.yaml>. Paths and versions are isolated in `src/api/endpoint-catalog.ts`.

The Sezzle documentation also links to `https://gateway.sezzle.com/v2api.yaml`, which returned 404 during implementation. The working published specification at `https://docs.sezzle.com/openapi.yaml` was used.

The pre-publication audit downloaded the official specification again and checked 21 implemented adapter operations for method/path presence, server URLs, authentication override, the four `Sezzle-Request-Id` headers, pagination parameters, CSV media types, money fields, v2 error shape, and all nine webhook event names. The audit reported zero mismatches. This remains documentation-level verification only.

## Pre-publication corrections

- Added a runtime/source-derived inventory generator and CI freshness check.
- Audited and recorded rejected support ownership verification attempts.
- Removed the newly created reauthorization order UUID from denied-approval error details.
- Separated support classification, routing, and escalation so those requested tools are no longer aliases.
- Converted support-facing capture/refund aggregation to `bigint`.
- Added regressions for all four documented financial idempotency headers and all seven finance write confirmation inputs.
- Tightened the container data directory from mode 755 to mode 700.
- Expanded `.gitignore` for public publication, including SQLite files, temporary data, IDE files, and `.vscode`.
- Replaced production-readiness implications with explicit experimental maturity and sandbox-validation warnings.
- Added [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) and [docs/SANDBOX_VALIDATION.md](docs/SANDBOX_VALIDATION.md).

No tools were removed. The final count remains 55 because the audit found no unsupported, placeholder, mocked-at-runtime, unwired, or permission-bypassing registrations.

## Public-repository security audit

- Redacted Gitleaks `v8.28.0` Docker scan: zero findings after replacing one synthetic idempotency fixture that triggered a generic-key heuristic.
- Metadata-only searches for Sezzle keys, GitHub/AWS tokens, JWTs, private-key blocks, bearer literals, local user paths, emails, UUIDs, card-length numbers, phones, street addresses, sample names, authorization assignments, and payload dumps found only explicit synthetic test fixtures.
- No `.env`, certificate/private-key, database, SQLite, log, or Git metadata files existed before publication.
- `.env.example` contains empty credential placeholders only.
- `npm audit` reported zero vulnerabilities. `npm ci` emitted an upstream deprecation warning for `prebuild-install`, a transitive package used while installing the native SQLite dependency.

## Container and transport audit

- `docker build -t sezzle-merchant-mcp:local .` passed using Node 20.
- Image user: `node`; runtime UID: 1000.
- `/app/data`: owner `node:node`, mode 700.
- Container started in sandbox/read-only mode without Sezzle credentials.
- `/health` returned `status=ok` and `service=sezzle-ops`.
- Unauthenticated `/mcp` returned HTTP 401.
- An authenticated official Streamable HTTP client reached MCP and listed 18 default-profile tools.
- An official stdio client listed 18 tools; protocol stdout remained clean and startup logging was valid JSON on stderr.
- `docker compose config` passed with a temporary synthetic transport token.

## Repository metadata suggestion

Suggested GitHub description:

> Unofficial, experimental, security-focused MCP server for Sezzle merchant operations, reconciliation, webhook diagnostics, and guarded payment workflows.

## Documented ambiguities

- Authorization event examples use nested `amount`, while the component schema uses flat `amount_in_cents` and `currency_code`. The adapter supports only those two documented forms and normalizes both.
- Settlement summaries document JSON floating values. Responses are parsed from text using a lossless number parser before conversion to integer minor units.
- Settlement details and interest activity are CSV. They are parsed with a standards-based CSV parser and exact decimal scaling.
- Sezzle webhook documentation currently describes signing with the merchant private key. The server binds that signing material through the separate `SEZZLE_WEBHOOK_SECRET` environment variable to avoid coupling and accidental disclosure.

## Undocumented or inaccessible features

- No documented endpoint lists arbitrary live merchant orders. Broad operational analysis therefore requires the allowlisted order report or structured merchant input; the server does not scrape dashboards.
- `GET /v2/orders/report` is available only after Sezzle allowlisting and permits at most seven days.
- Interest endpoints require merchant enrollment.
- Settlement details are delivered as CSV rather than a versioned JSON schema.
- Capture, refund, and release transaction UUIDs have no documented direct lookup endpoint; evidence is correlated through `GET /v2/order/{order_uuid}`.
- The upcharge endpoint is marked in development and unavailable for production, so it is intentionally absent.
- Consumer accounts, spending limits, underwriting, exact decline reasons, private mobile APIs, browser automation, and dashboard APIs are outside the documented merchant API and are not implemented.
- Tokenized-customer and virtual-card operations are documented but intentionally outside this merchant-operations scope because they expand customer-data and PCI boundaries.

## Known limitations

- Streamable HTTP is stateless. Durable workflow state is shared through one process and SQLite; horizontal multi-node coordination is not implemented.
- Remote HTTP uses a static bearer token and host/origin checks. Production deployments should add TLS and an identity-aware proxy; native OAuth/OIDC is not bundled.
- SQLite records are not application-level encrypted. Verified raw webhook bodies may contain personal data and require encrypted storage, access controls, retention, and backup policy.
- No automatic webhook retention/deletion scheduler is included.
- Support response drafting is deterministic policy templating. LLM-assisted prose remains the MCP client's responsibility and receives only returned minimal facts/policy.
- API contract drift is detected by tests when fixtures are updated, but the repository does not yet run an automated scheduled OpenAPI diff.

## Recommended next steps

1. Create a Sezzle sandbox merchant and run mocked plus sandbox contract smoke tests with synthetic orders.
2. Request order-report access and interest-account access only if those merchant workflows are needed.
3. Configure encrypted persistent storage and a webhook retention policy.
4. Put remote HTTP behind TLS and organization authentication; rotate the transport bearer token regularly.
5. Add shared transactional storage and request routing before horizontal scaling.
6. Add a scheduled OpenAPI drift check against the published Sezzle specification.
7. Run a merchant-specific threat model and go-live review before setting `SEZZLE_READ_ONLY=false` in production.

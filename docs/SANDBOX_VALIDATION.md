# Sezzle Sandbox Validation Checklist

This checklist must be completed with a dedicated Sezzle sandbox merchant before production use. Never record real credentials in this file, issue trackers, screenshots, terminal transcripts, or committed fixtures. Use synthetic customer and order data permitted by Sezzle's sandbox documentation.

## Preparation

- [ ] Create a dedicated sandbox merchant and test shopper.
- [ ] Generate sandbox-only public/private API keys.
- [ ] Set `SEZZLE_ENV=sandbox`, `SEZZLE_READ_ONLY=true`, `SEZZLE_REQUIRE_CONFIRMATION=true`, and the narrowest permission profile.
- [ ] Use encrypted local storage or an ephemeral test database.
- [ ] Record the code revision, date, Node version, Sezzle documentation revision, and non-secret merchant test label.

## Authentication

- [ ] Call `sezzle_authenticate_merchant` with sandbox configuration.
- [ ] Confirm the returned merchant UUID matches the configured sandbox merchant UUID.
- [ ] Confirm tokens never appear in stdout, stderr, MCP resources, audit records, or errors.
- [ ] Observe expiry/reacquisition behavior without recording the token.

## Payment session creation and retrieval

- [ ] In read-only mode, validate a synthetic session payload and confirm the mutation tool is absent.
- [ ] Enable `finance` write mode in sandbox only.
- [ ] Preview `sezzle_create_payment_session`; review normalized input, amount, currency, warnings, expiry, and audit ID.
- [ ] Execute with the unchanged preview ID and literal `confirm: true`.
- [ ] Confirm the API returns a sandbox checkout URL, session UUID, and order UUID.
- [ ] Retrieve the session with `sezzle_get_payment_session` and compare documented fields.

## Order retrieval

- [ ] Complete the synthetic shopper checkout using AUTH intent.
- [ ] Retrieve the order with `sezzle_get_order`.
- [ ] Confirm authorization amount, currency, approval, expiry, captures, refunds, and releases.
- [ ] Confirm customer names, email, phone, addresses, and payment details are absent from the MCP result.

## Capture preview and sandbox capture

- [ ] Preview a valid partial capture and an over-authorization capture.
- [ ] Confirm over-authorization is rejected before any API mutation.
- [ ] Execute the valid capture with unchanged input, preview ID, and `confirm: true`.
- [ ] Retrieve the order and confirm the API evidence and remaining capturable amount.
- [ ] Repeat the same execution attempt and confirm duplicate/idempotency behavior.

## Refund preview and sandbox refund

- [ ] Preview a valid partial refund and a refund above the remaining refundable amount.
- [ ] Confirm the excessive refund is rejected locally.
- [ ] Execute the valid refund with unchanged input, preview ID, and `confirm: true`.
- [ ] Retrieve the order and confirm refund evidence and remaining refundable amount.
- [ ] Simulate or observe a timeout only if it can be done safely; verify the same idempotency key is reused.

## Authorization release and reauthorization

- [ ] Create a separate AUTH order and preview a partial release.
- [ ] Execute the release and confirm the order's release evidence.
- [ ] Confirm a release above remaining authorization is rejected locally.
- [ ] After a sandbox authorization expires, preview reauthorization.
- [ ] Validate both approved and unapproved responses if Sezzle provides a safe sandbox mechanism.
- [ ] Confirm HTTP 200 with `approved: false` is recorded as failure and never reported as approval.

## Settlement and reports

- [ ] Request settlement summaries for a known synthetic date/currency.
- [ ] Retrieve settlement details and compare CSV columns, signs, currencies, and minor-unit conversions.
- [ ] Run deterministic reconciliation against synthetic merchant records.
- [ ] Request order-report access if needed; verify the seven-day range and customer-field stripping.
- [ ] Test interest endpoints only if the sandbox merchant is enrolled.

## Webhook creation and signature verification

- [ ] Configure a dedicated HTTPS test receiver with restricted access and raw-body preservation.
- [ ] Preview and create subscriptions for documented event names.
- [ ] Confirm list/get/update/delete/test endpoint behavior and response status codes.
- [ ] Capture the signature header name and format without storing the full signature.
- [ ] Verify HMAC-SHA256 against the exact raw body with the configured sandbox signing material.
- [ ] Confirm one-byte body changes fail verification before JSON parsing.

## Duplicate and out-of-order delivery

- [ ] Deliver the same verified event twice and confirm one stored event with an incremented duplicate count.
- [ ] Deliver or replay older occurrence-time events after newer events.
- [ ] Confirm the timeline sorts by occurrence time and no newer derived state is overwritten.

## Rate-limit handling and error normalization

- [ ] Coordinate a safe rate-limit test or use a Sezzle-provided sandbox mechanism; do not flood the service.
- [ ] Confirm `Retry-After` is respected for safe reads.
- [ ] Confirm mutations retry only with documented idempotency.
- [ ] Exercise documented 400, 401, 404, 422, 429, timeout, and 5xx responses where safely possible.
- [ ] Confirm normalized errors omit stacks, secrets, customer data, raw payloads, and full signatures.

## Audit verification

- [ ] Verify every preview, successful mutation, failed mutation, rejection, and webhook ingestion produces the expected audit result.
- [ ] Confirm failed operations are never marked successful.
- [ ] Confirm audit records contain hashes and evidence IDs, not secrets or full sensitive payloads.
- [ ] Restart with SQLite storage and confirm durable audit, preview, idempotency, and webhook records.

## Credential cleanup

- [ ] Return the server to `SEZZLE_READ_ONLY=true`.
- [ ] Remove sandbox credentials from the process environment, client config, shell history where possible, and secret mounts.
- [ ] Delete ephemeral databases and webhook captures according to the test retention plan.
- [ ] Rotate sandbox credentials if they appeared in any untrusted context.
- [ ] Record non-secret outcomes, discrepancies, and evidence references in a sandbox validation report.

## Exit criteria

Production use remains blocked until every applicable item passes, observed API differences are reflected in schemas/tests/limitations, security review approves the evidence, and a separate production change explicitly keeps preview, confirmation, idempotency, permission, and audit controls enabled.

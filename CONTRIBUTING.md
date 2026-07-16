# Contributing

Contributions are welcome. This is an unofficial project and contributions must not imply affiliation with or endorsement by Sezzle.

## Git workflow

- Use a feature or fix branch for future development; do not develop features directly on `main`.
- Open a pull request and wait for passing CI before merge.
- Use Conventional Commits, for example `feat:`, `fix:`, `docs:`, `test:`, or `chore:`.
- Never commit credentials, tokens, real customer data, webhook payloads, payment data, local databases, or logs.
- Add relevant tests for every behavioral or safety change.
- Update documentation and regenerate `docs/TOOL_INVENTORY.md` whenever the tool surface changes.

## Development

1. Install Node.js 20 or later.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and use sandbox credentials only.
4. Run `npm run build` and `npm run inspect-tools`.

Before opening a pull request, run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run inspect-tools:check
npm run test:coverage
npm run build
```

## API changes

- Confirm every endpoint and schema in <https://docs.sezzle.com/openapi.yaml>.
- Do not infer or add private, mobile, dashboard, browser, or undocumented endpoints.
- Isolate documented ambiguities in an adapter and add contract fixtures.
- Keep tool registration thin; put workflows in services and arithmetic in domain modules.

## Safety changes

Changes to read-only filtering, permission profiles, confirmation gates, preview binding, idempotency, merchant ownership, redaction, or webhook verification require focused regression tests and a security rationale in the pull request.

Use synthetic fixtures. Never commit credentials, access tokens, real webhook bodies, customer data, payment details, or production identifiers.

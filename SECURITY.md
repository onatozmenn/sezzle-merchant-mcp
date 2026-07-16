# Security Policy

## Supported versions

Security fixes are applied to the latest release on the `main` branch. Pre-1.0 releases may contain breaking changes, but safety controls are not intentionally weakened.

## Maturity warning

This is an unofficial, experimental integration with mocked API coverage. It has not been validated using real Sezzle merchant sandbox credentials. Do not enable production financial mutations until [the sandbox validation checklist](docs/SANDBOX_VALIDATION.md) has passed and the resulting evidence has been reviewed.

## Reporting a vulnerability

Use GitHub private vulnerability reporting or a private GitHub Security Advisory for this repository. Do not open a public issue containing credentials, customer data, webhook bodies, signatures, or exploit details.

Include the affected version, configuration, reproduction steps using synthetic data, impact, and suggested mitigation. Do not test against merchant systems or Sezzle accounts you do not own or administer.

## Operational security

- Keep the server sandboxed, read-only, and on stdio or loopback HTTP until the integration is validated.
- Store production credentials in a secret manager and inject them as environment variables.
- Rotate any credential, bearer token, or webhook secret that may have been exposed.
- Use TLS termination and strong authentication before exposing Streamable HTTP remotely.
- Configure `MCP_HTTP_ALLOWED_HOSTS` for every non-loopback deployment and restrict `MCP_HTTP_ALLOWED_ORIGINS` when browser clients are required.
- Use `SEZZLE_STORAGE=sqlite` on encrypted storage for durable audit and webhook records. Verified raw webhook bodies may contain personal data; apply access controls, backup encryption, and a retention policy.
- Protect the SQLite volume as merchant-sensitive operational data.
- Review audit failures and rejected confirmations; never bypass preview binding or idempotency checks.

## Security invariants

The following are treated as security boundaries:

- mutation tools are absent in read-only mode;
- permission profiles filter tools before registration;
- financial execution requires a matching, unexpired preview and literal `confirm: true`;
- webhook signatures are verified over raw bytes before parsing;
- money arithmetic uses integer minor units and `bigint`;
- merchant identity and order reference checks precede support order exposure;
- logs and resources exclude secrets, signatures, raw payloads, and customer data.

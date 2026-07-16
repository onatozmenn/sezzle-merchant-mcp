# SezzleOps MCP repository instructions

- Treat <https://docs.sezzle.com/llms.txt> and <https://docs.sezzle.com/openapi.yaml> as the source of truth for Sezzle merchant endpoints and schemas.
- Do not add an endpoint that is absent from the published Sezzle OpenAPI document.
- Use the production MCP TypeScript SDK v1 documentation at <https://ts.sdk.modelcontextprotocol.io/> and source at <https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x>.
- Keep MCP registration thin. Put validation and workflows in services and deterministic arithmetic in domain modules.
- Store money as integer minor units and calculate with `bigint`; never use floating-point arithmetic for financial values.
- Never weaken read-only registration, permission filtering, explicit `confirm: true`, preview binding, idempotency, redaction, or merchant ownership checks.
- Never log API secrets, bearer tokens, complete webhook signatures, customer personal data, or payment details.
- Run focused tests and `npm run typecheck` after changes to behavior.

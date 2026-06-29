# Browser E2E

This directory contains the Chapter 20 browser-level full-chain test. It is intentionally opt-in because it uses a real browser, real services, and normally a real LLM call.

## Prerequisites

Start the complete local stack first:

```bash
cd infra/compose
POSTGRES_PASSWORD=postgres OPENAI_API_KEY=... docker compose up --build
```

The compose stack exposes:

- chat-web: `http://localhost:3002`
- chat API: `http://localhost:4001`
- user-system API: `http://localhost:4002/api`

Seeded login credentials:

- username: `admin`
- password: `Admin@123456`

## Run

```bash
RUN_BROWSER_E2E=1 bun run test:e2e
```

Optional overrides:

```bash
RUN_BROWSER_E2E=1 \
E2E_WEB_URL=http://localhost:3002 \
E2E_CHAT_API_URL=http://localhost:4001 \
E2E_USER_API_URL=http://localhost:4002/api \
E2E_USERNAME=admin \
E2E_PASSWORD=Admin@123456 \
bun run test:e2e
```

## Coverage

The main test covers:

- browser login through `user-system`
- JWT storage and authenticated chat API calls
- `ChatView` posting to the SSE controller
- assistant message persistence in Postgres
- artifact persistence and `ArtifactPanel` rendering
- deployment smoke endpoints: `/ready`, `/metrics`, `/api/cost/summary`

Because it is slow and can spend token budget, keep it in nightly/release pipelines or run it manually before a release.

# Purch API

This is an [x402](https://docs.cdp.coinbase.com/x402/) API for Purch — our hackathon project showcasing an x402-powered checkout using USDC on Solana, with fulfillment handled via Crossmint and persistence in Supabase, allowing users to buy 1B+ items on Amazon, Shopify and other stores. Purch is already listed on the [x402 Bazaar discovery layer](https://docs.cdp.coinbase.com/x402/bazaar), so builders browsing Coinbase's CDP catalog can try the live experience immediately. We open-sourced the code for transparency and to help judges and reviewers run the demo locally. 

## Live Service
- API base: https://x402.purch.xyz or https://x-purch-741433844771.us-east1.run.app
- Health: https://x402.purch.xyz/health
- Docs: https://x402.purch.xyz/docs
- Create order (POST): https://x402.purch.xyz/orders/solana

## Why It Matters
- **x402-native checkout** – Every POST to `/orders/solana` runs through Coinbase's x402 middleware for signed, enforceable paywalls.
- **USDC on Solana** – Fast, low-fee payments; payer identity is logged for auditing.
- **Crossmint fulfillment** – Commerce APIs handle order creation and delivery state.
- **Type-safe infra** – Zod, Drizzle ORM, and Biome for safety and clarity.
- **Self-discoverable** – `/docs` exposes an OpenAPI spec; logs are verbose for demoing.

## Architecture at a Glance
```
Client (wallet + x402 signer)
        │
        ▼
POST /orders/solana  ──► Hono router ──► x402 middleware (pricing, signature, payer logging)
        │
        ├─► Validation (Zod schemas + custom middleware)
        ├─► Crossmint order creation + serialized Solana transaction
        └─► Drizzle ORM ➜ Supabase/Postgres (orders + users tables)

GET /orders/:id ──► bcrypt-secured status lookup that proxies Crossmint order state
```

## Quick Start
1. **Prereqs**
	- [Bun](https://bun.sh) v1.1+
	- Postgres/Supabase URL with service role credentials
	- Solana wallet capable of receiving x402 payments
	- Crossmint server-side API key
2. **Install**
	```bash
	bun install
	```
3. **Configure**
	- Create a `.env` file (or update the existing one) with the variables below.
	- Run `bun run dev` and hit `http://localhost:3000/health`.

### Required Environment Variables
| Name | Description |
| --- | --- |
| `SUPABASE_DATABASE_URL` | Postgres URL with `sslmode=require`; Supabase service-role is ideal. |
| `NODE_ENV` | `development`, `test`, or `production`. Defaults to `production`. |
| `CROSSMINT_API_KEY` | Server-side Crossmint key for order creation/status. |
| `CROSSMINT_API_BASE_URL` | Optional override for Crossmint's REST endpoint. |
| `X402_SOLANA_WALLET_ADDRESS` | Solana wallet that receives the x402 challenge payment. |
| `X402_CDP_API_KEY_ID` / `X402_CDP_API_KEY_SECRET` | Coinbase CDP API credentials for x402. |

Missing or malformed values cause `src/env.ts` to throw before the server boots.

### Daily Commands
| Action | Command |
| --- | --- |
| Start dev server (hot reload) | `bun run dev` |
| Lint (Biome) | `bun run lint` |
| Lint + fix | `bun run lint:fix` |
| Format | `bun run format` |
| Tests | `bun test` |
| Generate Drizzle SQL | `bun run db:generate` |
| Push migrations | `bun run db:migrate` |
| Drizzle Studio | `bun run db:studio` |

## API Tour
### Create an order (USDC on Solana)
1. Sign the x402 challenge returned from the first request.
2. Re-run the call with the `X-PAYMENT` header.

```bash
curl -X POST http://localhost:3000/orders/solana \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <serialized x402 payment>" \
  -d '{
    "email": "satoshi@example.com",
    "payerAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "productUrl": "https://www.amazon.com/dp/B08N5WRWNW",
    "physicalAddress": {
      "name": "Satoshi Nakamoto",
      "line1": "1 Market St",
      "city": "San Francisco",
      "postalCode": "94105",
      "country": "US"
    },
    "locale": "en-US"
  }'
```

Response (201):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "clientSecret": "eyXams...",
  "serializedTransaction": "AQABAg...",
  "paymentStatus": "pending",
  "lineItems": [...]
}
```

### Check order status
```bash
curl http://localhost:3000/orders/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: <clientSecret>"
```
Returns the upstream Crossmint order payload, including payment, quote, and delivery states. Invalid secrets receive `403`.

### Discoverable helpers
- `GET /` – service metadata and handy links
- `GET /docs` – generated OpenAPI description (mirrors the handler definitions in `src/index.ts`)
- `GET /health` – readiness probe for monitors or deployment platforms

## Database + Drizzle Workflow
- Schemas live in `src/db/schema.ts` and are the single source of truth.
- `bun run db:generate` diffs the schema and drops SQL into `drizzle/`.
- `bun run db:migrate` applies migrations against the Supabase database configured in `.env`.
- `bun run db:studio` opens Drizzle Studio for live table inspection.

Tables included:
- `users` – wallet address + network + email for auditing
- `orders` – x402 payment metadata, hashed encrypted client secrets, timestamps

## Testing & Observability
- Use `bun test` for colocated `*.test.ts` suites (example: add `orders/handlers.test.ts`).
- Request/response logging is intentionally verbose (`console.log`/`console.error`) so you can follow each step without attaching a profiler.
- Validation failures return flattened Zod error payloads to help frontends debug quickly.

## Project Layout
```
src/
  index.ts            # Hono router + x402 wiring + route registration
  env.ts              # @t3-oss/env-core schema that validates Bun.env at boot
  middleware/         # Shared validation middleware
  orders/             # Crossmint client, schemas, and route handlers
  db/
    schema.ts         # Drizzle schema + enums
    client.ts         # postgres client with SSL + connection pooling
drizzle/              # Generated SQL migrations
```

## Deployment Notes
- The server is edge-friendly: `bun run src/index.ts` is stateless outside of Postgres.
- Supply production secrets via environment variables; the app fails fast if anything is missing.
- Health check is `GET /health`; load balancers can use it for readiness.
- To ship a public demo, point your x402 credentials to Coinbase's production CDP environment and update `SUPABASE_DATABASE_URL` to the managed database.

## Demo Tips
1. Run `bun run dev`, call `POST /orders/solana`, approve the x402 challenge, then show `GET /orders/:id` updating.
2. Show logs from the payer logging middleware to visualize wallet attribution.


Questions or ideas? Please open an issue. We welcome feedback!

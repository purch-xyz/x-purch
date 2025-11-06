# purch api

hey there—this repo holds the hono api that powers our purch x402 experiments plus a lightweight solana checkout console for demos. it's running on bun, pulls its config from `src/env.ts`, and talks to supabase through drizzle.

## what you get
- a hono app in `src/index.ts` that's already wired for the x402 middleware.
- drizzle orm tables for `users_x402` and `orders_x402` tracking wallet activity (see `src/db/schema.ts`).
- a postgres client in `src/db/client.ts`, configured to use the supabase service role url with strict ssl.
- a vite/react frontend under `apps/solana-frontend` that walks judges through the Solana payment flow.

## setup
1. install the bun runtime if you haven't: `curl -fsSL https://bun.sh/install | bash`
2. install deps: `bun install`

drop a `.env` file at the project root with:
```
SUPABASE_DATABASE_URL="postgres://service-role:@supabase-url"
CROSSMINT_API_KEY="crossmint api key"
# optional, defaults to production:
# CROSSMINT_API_BASE_URL="https://www.crossmint.com/api"
X402_SOLANA_WALLET_ADDRESS="Solana wallet receiving payments"
X402_BASE_WALLET_ADDRESS="0x... base wallet receiving payments"
X402_CDP_API_KEY_ID="coinbase cdp key id"
X402_CDP_API_KEY_SECRET="coinbase cdp key secret"
```
the schema in `src/env.ts` will crash fast if that value is missing or malformed, so you know right away when something's off.

## daily commands
- dev server with hot reload: `bun run dev` (listens on http://localhost:3000)
- solana web console: `bun run frontend:dev` (spins up Vite on http://localhost:5173)
- lint the codebase: `bun run lint`
- auto-fix lint issues when possible: `bun run lint:fix`
- format everything with biome: `bun run format`
- run tests: `bun test`

## database workflow
- generate sql migrations from the drizzle schema: `bun run db:generate`
- push migrations to supabase: `bun run db:migrate`
- open drizzle studio against the same database: `bun run db:studio`

generated sql lands in the `drizzle/` folder. keep schema changes in `src/db/` and let the commands handle the rest.

## solana checkout console
The `apps/solana-frontend` project gives judges a simple form to exercise `POST /orders/solana` end to end:

1. Install the frontend dependencies once: `npm install` inside `apps/solana-frontend/`.
2. Terminal A — run the API: `bun run dev`.
3. Terminal B — start the console: `bun run frontend:dev`.
4. Open http://localhost:5173, connect your Solana wallet (Phantom or Backpack), and fill in the order form. The payer address auto-populates from the connected wallet.
5. Submit. The UI calls the API once, expects a `402 Payment Required`, then prompts to “Authorize Payment & Finalize”; your wallet signs the transaction to retry with an x402 signature.
6. The response console shows the decoded `X-PAYMENT-RESPONSE` header plus the JSON payload from the API.

Prefer command-line testing? You can skip the frontend and run `bun run src/clients/solana-client.ts` to drive the same flow.

## project layout
```
src/
  index.ts         hono entrypoint
  env.ts           zod-powered runtime config
  db/
    schema.ts      drizzle table definitions
    client.ts      postgres + drizzle client
apps/
  solana-frontend/ React/Vite Solana demo console
drizzle/           generated migrations
```

update routes under `src/` as features grow, keep tests beside the files they cover, and lean on bun's speed for the tight inner loop.

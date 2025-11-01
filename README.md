# purch api

hey there—this repo holds the hono api that powers our purch experiments. it's running on bun, pulls its config from `src/env.ts`, and talks to supabase through drizzle.

## what you get
- a hono app in `src/index.ts` that's already wired for routing.
- drizzle orm with an `orders` table (`id`, `status`, `created_at`, `updated_at`) defined in `src/db/schema.ts`.
- a postgres client in `src/db/client.ts`, configured to use the supabase service role url with strict ssl.

## setup
1. install the bun runtime if you haven't: `curl -fsSL https://bun.sh/install | bash`
2. install deps: `bun install`

drop a `.env` file at the project root with:
```
SUPABASE_DATABASE_URL="postgres://service-role:@supabase-url"
```
the schema in `src/env.ts` will crash fast if that value is missing or malformed, so you know right away when something's off.

## daily commands
- dev server with hot reload: `bun run dev` (listens on http://localhost:3000)
- lint the codebase: `bun run lint`
- auto-fix lint issues when possible: `bun run lint:fix`
- format everything with biome: `bun run format`
- run tests: `bun test`

## database workflow
- generate sql migrations from the drizzle schema: `bun run db:generate`
- push migrations to supabase: `bun run db:migrate`
- open drizzle studio against the same database: `bun run db:studio`

generated sql lands in the `drizzle/` folder. keep schema changes in `src/db/` and let the commands handle the rest.

## project layout
```
src/
  index.ts         hono entrypoint
  env.ts           zod-powered runtime config
  db/
    schema.ts      drizzle table definitions
    client.ts      postgres + drizzle client
drizzle/           generated migrations
```

update routes under `src/` as features grow, keep tests beside the files they cover, and lean on bun's speed for the tight inner loop.

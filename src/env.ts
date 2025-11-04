import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		SUPABASE_DATABASE_URL: z.url().describe("PostgreSQL database URL"),
		CROSSMINT_API_KEY: z.string().min(1).describe("Crossmint API key"),
		CROSSMINT_API_BASE_URL: z.string().url().optional(),
		X402_SOLANA_WALLET_ADDRESS: z
			.string()
			.min(1)
			.describe("Solana wallet address receiving x402 payments"),
		X402_BASE_WALLET_ADDRESS: z
			.string()
			.regex(/^0x[0-9a-fA-F]{40}$/)
			.describe("Base wallet address receiving x402 payments"),
		X402_CDP_API_KEY_ID: z.string().min(1),
		X402_CDP_API_KEY_SECRET: z.string().min(1),
	},
	runtimeEnv: Bun.env,
	emptyStringAsUndefined: true,
});

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		SUPABASE_DATABASE_URL: z
			.url()
			.describe("PostgreSQL database URL"),
	},
	runtimeEnv: Bun.env,
	emptyStringAsUndefined: true,
});

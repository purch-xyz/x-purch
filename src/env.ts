import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		SUPABASE_DATABASE_URL: z
			.url()
			   .refine(
				(url) => url.includes("supabase.co"),
				"SUPABASE_DATABASE_URL must point to Supabase",
			),
	},
	runtimeEnv: Bun.env,
	emptyStringAsUndefined: true,
});

import { defineConfig } from "drizzle-kit";
import "dotenv/config";

const shouldVerifySupabaseCert = process.env.NODE_ENV !== "development";

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.SUPABASE_DATABASE_URL ?? "",
		ssl: { rejectUnauthorized: shouldVerifySupabaseCert },
	},
});

import { Hono } from "hono";
import { createFacilitatorConfig } from "@coinbase/x402";
import { env } from "./env";

const app = new Hono();

app.get("/test-facilitator", async (c) => {
	try {
		console.log("[TEST] Creating facilitator config...");
		const facilitatorConfig = createFacilitatorConfig(
			env.X402_CDP_API_KEY_ID,
			env.X402_CDP_API_KEY_SECRET,
		);

		console.log("[TEST] Facilitator config created successfully");
		console.log("[TEST] Config URL:", facilitatorConfig.url);

		// Try to make a test request to the facilitator
		const testHeaders = facilitatorConfig.createAuthHeaders();
		console.log("[TEST] Auth headers created:", Object.keys(testHeaders));

		// Test connectivity to CDP API
		const response = await fetch("https://api.cdp.coinbase.com/v2/ping", {
			headers: testHeaders,
		});

		console.log("[TEST] CDP API ping response:", response.status);

		return c.json({
			success: true,
			facilitatorUrl: facilitatorConfig.url,
			cdpPingStatus: response.status,
			environment: {
				hasApiKeyId: !!env.X402_CDP_API_KEY_ID,
				hasApiKeySecret: !!env.X402_CDP_API_KEY_SECRET,
				walletAddress: env.X402_SOLANA_WALLET_ADDRESS,
			},
		});
	} catch (error) {
		console.error("[TEST] Facilitator test failed:", error);
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		}, 500);
	}
});

export default app;
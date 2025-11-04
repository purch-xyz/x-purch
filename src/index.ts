import { createFacilitatorConfig } from "@coinbase/x402";
import { Hono } from "hono";
import type { Address } from "viem";
import { paymentMiddleware, type SolanaAddress } from "x402-hono";
import { env } from "./env";
import { buildCreateOrderHandler } from "./orders/handlers";
import {
	baseCreateOrderSchema,
	solanaCreateOrderSchema,
} from "./orders/schemas";

const facilitatorConfig = createFacilitatorConfig(
	env.X402_CDP_API_KEY_ID,
	env.X402_CDP_API_KEY_SECRET,
);

const app = new Hono();

app.use(
	"/orders/solana",
	paymentMiddleware(
		env.X402_SOLANA_WALLET_ADDRESS as SolanaAddress,
		{
			"POST /orders/solana": {
				price: "$0.01",
				network: "solana",
				config: {
					description:
						"Create an amazon order payable with 0.01 USDC on Solana",
					discoverable: false,
				},
			},
		},
		facilitatorConfig,
	),
);

app.use(
	"/orders/base",
	paymentMiddleware(
		env.X402_BASE_WALLET_ADDRESS as Address,
		{
			"POST /orders/base": {
				price: {
					amount: "10000",
					asset: {
						address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
						decimals: 6,
						eip712: {
							name: "USD Coin",
							version: "2",
						},
					},
				},
				network: "base",
				config: {
					description: "Create an amazon order payable with 0.01 USDC on Base",
					discoverable: false,
				},
			},
		},
		facilitatorConfig,
	),
);

app.post(
	"/orders/solana",
	buildCreateOrderHandler({
		schema: solanaCreateOrderSchema,
		paymentMethod: "solana",
	}),
);

app.post(
	"/orders/base",
	buildCreateOrderHandler({
		schema: baseCreateOrderSchema,
		paymentMethod: "base",
	}),
);

app.get("/", (c) => {
	return c.json({
		status: "ok",
		endpoints: {
			solana: "/orders/solana",
			base: "/orders/base",
		},
	});
});

app.get("/health", (c) => {
	return c.json({
		status: "ok",
		service: "purch-api",
	});
});

export default app;

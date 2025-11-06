import { createFacilitatorConfig } from "@coinbase/x402";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { Address } from "viem";
import { decodePayment } from "x402/schemes";
import { svm } from "x402/shared";
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

const createPayerLoggingMiddleware = (
	paymentMethod: string,
): MiddlewareHandler => {
	return async (c, next) => {
		const paymentHeader = c.req.header("X-PAYMENT");

		if (paymentHeader) {
			try {
				const decodedPayment = decodePayment(paymentHeader);
				let payerAddress: string | undefined;

				if ("authorization" in decodedPayment.payload) {
					payerAddress = decodedPayment.payload.authorization.from;
				} else if ("transaction" in decodedPayment.payload) {
					try {
						const transaction = svm.decodeTransactionFromPayload(
							decodedPayment.payload,
						);
						const extracted = svm.getTokenPayerFromTransaction(transaction);
						payerAddress = extracted.length > 0 ? extracted : undefined;
					} catch (transactionError) {
						console.warn("[x402] Unable to decode Solana payment payload", {
							paymentMethod,
							network: decodedPayment.network,
							error:
								transactionError instanceof Error
									? transactionError.message
									: String(transactionError),
						});
					}
				}

				console.log("[x402] Payment authorized", {
					paymentMethod,
					network: decodedPayment.network,
					path: `${c.req.method.toUpperCase()} ${c.req.path}`,
					payerAddress: payerAddress ?? null,
				});
			} catch (error) {
				console.warn("[x402] Failed to parse X-PAYMENT header", {
					paymentMethod,
					path: `${c.req.method.toUpperCase()} ${c.req.path}`,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		await next();
	};
};

const app = new Hono();

const allowedOrigins = [
	"http://localhost:5173",
	"http://127.0.0.1:5173",
	"http://localhost:4173",
	"http://127.0.0.1:4173",
];

app.use(
	"*",
	cors({
		origin: (origin) => {
			if (!origin) return null;
			if (allowedOrigins.includes(origin)) {
				return origin;
			}
			return null;
		},
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: [
			"Content-Type",
			"X-PAYMENT",
			"X-PAYMENT-RESPONSE",
			"Authorization",
			"Access-Control-Expose-Headers",
			"access-control-expose-headers",
		],
		exposeHeaders: ["X-PAYMENT-RESPONSE"],
		credentials: true,
	}),
);

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
app.use("/orders/solana", createPayerLoggingMiddleware("solana"));

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
app.use("/orders/base", createPayerLoggingMiddleware("base"));

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

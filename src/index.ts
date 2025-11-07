import { createFacilitatorConfig } from "@coinbase/x402";
import { Hono, type MiddlewareHandler } from "hono";
import { decodePayment } from "x402/schemes";
import { svm } from "x402/shared";
import { paymentMiddleware, type SolanaAddress } from "x402-hono";
import { env } from "./env";
import { createPaymentDebugMiddleware } from "./middleware/payment-debug";
import { createValidationMiddleware } from "./middleware/validation";
import {
	buildCreateOrderHandler,
	getOrderStatusHandler,
} from "./orders/handlers";
import { solanaCreateOrderSchema } from "./orders/schemas";

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

app.use("/orders/solana", createValidationMiddleware(solanaCreateOrderSchema));
app.use("/orders/solana", createPayerLoggingMiddleware("solana"));
app.use("/orders/solana", createPaymentDebugMiddleware());

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
						"Create an e-commerce order (Amazon, Shopify, etc.) paid with USDC on Solana. Includes product fulfillment to physical address.",
					discoverable: true,
					inputSchema: {
						bodyType: "json",
						bodyFields: {
							email: {
								type: "string",
								format: "email",
								description: "Email address for order notifications",
								required: true,
							},
							payerAddress: {
								type: "string",
								pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
								description: "Solana wallet address in base58 format",
								required: true,
							},
							productUrl: {
								type: "string",
								format: "uri",
								description:
									"Product URL from Amazon, Shopify, or browser automation sites",
								required: true,
							},
							physicalAddress: {
								type: "object",
								description: "Shipping address for product delivery",
								required: true,
								properties: {
									name: {
										type: "string",
										description: "Recipient name",
										required: true,
									},
									line1: {
										type: "string",
										description: "Address line 1",
										required: true,
									},
									line2: {
										type: "string",
										description: "Address line 2 (optional)",
									},
									city: { type: "string", description: "City", required: true },
									state: {
										type: "string",
										description: "State/Province (optional)",
									},
									postalCode: {
										type: "string",
										description: "Postal/ZIP code",
										required: true,
									},
									country: {
										type: "string",
										pattern: "^[A-Z]{2}$",
										description: "ISO 3166-1 alpha-2 country code (e.g., US)",
										required: true,
									},
								},
							},
							locale: {
								type: "string",
								description: "Preferred locale (optional, e.g., en-US)",
							},
						},
					},
					outputSchema: {
						orderId: {
							type: "string",
							format: "uuid",
							description: "Unique order identifier for tracking",
						},
						clientSecret: {
							type: "string",
							description: "Client secret required to check order status",
						},
						serializedTransaction: {
							type: "string",
							description:
								"Base64 encoded Solana transaction ready for signing",
						},
					},
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

// Order status endpoint (not protected by x402)
app.get("/orders/:orderId", getOrderStatusHandler);

app.get("/", (c) => {
	return c.json({
		name: "Purch API",
		version: "1.0.0",
		description:
			"x402-enabled e-commerce API for creating crypto-powered product orders",
		protocol: "x402",
		documentation: `${c.req.url}docs`,
		endpoints: [
			{
				path: "POST /orders/solana",
				description: "Create an order payable with USDC on Solana",
				payment: {
					required: true,
					protocol: "x402",
					price: "$0.01",
					network: "solana",
					token: "USDC",
				},
				requestBody: {
					email: "string (required)",
					payerAddress: "string (required, Solana base58 address)",
					productUrl: "string (required, URL)",
					physicalAddress: {
						name: "string (required)",
						line1: "string (required)",
						line2: "string (optional)",
						city: "string (required)",
						state: "string (optional)",
						postalCode: "string (required)",
						country: "string (required, ISO 3166-1 alpha-2)",
					},
					locale: "string (optional)",
				},
				headers: {
					Location: "string (URL to the created order resource)",
				},
				response: {
					orderId: "string (UUID)",
					serializedTransaction: "string (base64 encoded Solana transaction)",
				},
			},
			{
				path: "GET /orders/:orderId",
				description: "Get order status by ID",
				payment: {
					required: false,
					protocol: "Authorization header validated against bcrypt hash",
				},
				headers: {
					Authorization: "string (required, client secret)",
				},
				response: {
					orderId: "string (UUID)",
					status: "string (pending | processing | completed | failed)",
					createdAt: "string (ISO 8601 timestamp)",
				},
			},
			{
				path: "GET /health",
				description: "Health check endpoint",
				payment: {
					required: false,
				},
			},
			{
				path: "GET /docs",
				description: "OpenAPI specification",
				payment: {
					required: false,
				},
			},
		],
		links: {
			x402Protocol: "https://x402.org",
			repository: "https://github.com/purch-xyz/purch-api",
		},
	});
});

app.get("/health", (c) => {
	return c.json({
		status: "ok",
		service: "purch-api",
	});
});

app.get("/docs", (c) => {
	const baseUrl = new URL(c.req.url).origin;

	return c.json({
		openapi: "3.0.0",
		info: {
			title: "Purch API",
			version: "1.0.0",
			description:
				"x402-enabled e-commerce API for creating crypto-powered product orders on Amazon, Shopify, and other platforms. Payments are processed using the x402 protocol with USDC on Solana.",
			contact: {
				name: "Purch",
				url: "https://github.com/purch-xyz/purch-api",
			},
			license: {
				name: "MIT",
			},
		},
		servers: [
			{
				url: baseUrl,
				description: "API Server",
			},
		],
		tags: [
			{
				name: "orders",
				description: "Order creation and management",
			},
			{
				name: "health",
				description: "Health check endpoints",
			},
		],
		paths: {
			"/": {
				get: {
					summary: "API Information",
					description: "Get API metadata and available endpoints",
					tags: ["health"],
					responses: {
						"200": {
							description: "API information",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											name: { type: "string" },
											version: { type: "string" },
											description: { type: "string" },
											protocol: { type: "string" },
											documentation: { type: "string" },
											endpoints: { type: "array" },
										},
									},
								},
							},
						},
					},
				},
			},
			"/health": {
				get: {
					summary: "Health Check",
					description: "Check API health status",
					tags: ["health"],
					responses: {
						"200": {
							description: "Service is healthy",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											status: { type: "string", example: "ok" },
											service: { type: "string", example: "purch-api" },
										},
									},
								},
							},
						},
					},
				},
			},
			"/orders/solana": {
				post: {
					summary: "Create Order (Solana)",
					description:
						"Create an e-commerce order paid with USDC on Solana. Supports Amazon, Shopify, and browser automation platforms. Requires x402 payment of $0.01 USDC.",
					tags: ["orders"],
					"x-x402": {
						price: "$0.01",
						network: "solana",
						token: "USDC",
						required: true,
					},
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: [
										"email",
										"payerAddress",
										"productUrl",
										"physicalAddress",
									],
									properties: {
										email: {
											type: "string",
											format: "email",
											description: "Email address for order notifications",
											example: "customer@example.com",
										},
										payerAddress: {
											type: "string",
											pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
											description: "Solana wallet address (base58 format)",
											example: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
										},
										productUrl: {
											type: "string",
											format: "uri",
											description:
												"Product URL from supported platforms (Amazon, Shopify, browser automation sites)",
											example: "https://www.amazon.com/dp/B08N5WRWNW",
										},
										physicalAddress: {
											type: "object",
											required: [
												"name",
												"line1",
												"city",
												"postalCode",
												"country",
											],
											properties: {
												name: {
													type: "string",
													description: "Recipient name",
													example: "John Doe",
												},
												line1: {
													type: "string",
													description: "Address line 1",
													example: "123 Main St",
												},
												line2: {
													type: "string",
													description: "Address line 2 (optional)",
													example: "Apt 4B",
												},
												city: {
													type: "string",
													description: "City",
													example: "San Francisco",
												},
												state: {
													type: "string",
													description: "State/Province (optional)",
													example: "CA",
												},
												postalCode: {
													type: "string",
													description: "Postal code",
													example: "94102",
												},
												country: {
													type: "string",
													pattern: "^[A-Z]{2}$",
													description: "ISO 3166-1 alpha-2 country code",
													example: "US",
												},
											},
										},
										locale: {
											type: "string",
											description: "Preferred locale (optional)",
											example: "en-US",
										},
									},
								},
							},
						},
					},
					responses: {
						"201": {
							description: "Order created successfully",
							headers: {
								Location: {
									description: "Absolute URL for the created order resource",
									schema: {
										type: "string",
										format: "uri",
									},
								},
							},
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											orderId: {
												type: "string",
												format: "uuid",
												description: "Unique order identifier",
												example: "550e8400-e29b-41d4-a716-446655440000",
											},
											clientSecret: {
												type: "string",
												description:
													"Client secret required to check order status",
												example: "$2b$10$...",
											},
											serializedTransaction: {
												type: "string",
												description:
													"Base64 encoded serialized Solana transaction ready for signing",
											},
										},
									},
								},
							},
						},
						"402": {
							description: "Payment Required (x402)",
							headers: {
								"X-PAYMENT": {
									schema: { type: "string" },
									description: "x402 payment challenge",
								},
							},
						},
						"400": {
							description: "Invalid request body",
						},
					},
				},
			},
			"/orders/{orderId}": {
				get: {
					summary: "Get Order Status",
					description:
						"Retrieve the status of an order by ID. Requires authorization header with client secret.",
					tags: ["orders"],
					parameters: [
						{
							name: "orderId",
							in: "path",
							required: true,
							schema: {
								type: "string",
								format: "uuid",
							},
							description: "Order ID",
							example: "550e8400-e29b-41d4-a716-446655440000",
						},
					],
					security: [
						{
							ClientSecret: [],
						},
					],
					responses: {
						"200": {
							description: "Order status retrieved",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											orderId: {
												type: "string",
												format: "uuid",
											},
											status: {
												type: "string",
												enum: ["pending", "processing", "completed", "failed"],
												description: "Current order status",
											},
											createdAt: {
												type: "string",
												format: "date-time",
												description: "ISO 8601 timestamp",
											},
										},
									},
								},
							},
						},
						"401": {
							description: "Unauthorized - Invalid or missing client secret",
						},
						"404": {
							description: "Order not found",
						},
					},
				},
			},
		},
		components: {
			securitySchemes: {
				ClientSecret: {
					type: "apiKey",
					in: "header",
					name: "Authorization",
					description:
						"Client secret returned from order creation. Used to authenticate order status requests.",
				},
			},
		},
		externalDocs: {
			description: "x402 Protocol Documentation",
			url: "https://docs.cdp.coinbase.com/x402",
		},
	});
});

export default app;

import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { ZodType } from "zod";
import { db } from "../db/client";
import { orders, users, type X402Network } from "../db/schema";
import {
	CrossmintOrderError,
	createCrossmintOrder,
	type PhysicalAddress,
} from "./createCrossmintOrder";
import { CrossmintGetOrderError, getCrossmintOrder } from "./getCrossmintOrder";
import {
	getOrderStatusHeadersSchema,
	getOrderStatusParamsSchema,
} from "./schemas";

interface CreateOrderPayload {
	email: string;
	payerAddress: string;
	locale?: string;
	physicalAddress: PhysicalAddress;
	productUrl: string;
}

interface CreateOrderHandlerConfig<
	TSchema extends ZodType<CreateOrderPayload>,
> {
	schema: TSchema;
	paymentMethod: X402Network;
}

interface SaveOrderParams {
	orderId: string;
	email: string;
	payerAddress: string;
	network: X402Network;
	clientSecret: string;
}

const SALT_ROUNDS = 10;

const hashClientSecret = (secret: string): string => {
	return createHash("sha256").update(secret).digest("hex");
};

const saveOrderRecord = async ({
	orderId,
	email,
	payerAddress,
	network,
	clientSecret,
}: SaveOrderParams) => {
	const sha256Hash = hashClientSecret(clientSecret);
	const hashedSecret = await bcrypt.hash(sha256Hash, SALT_ROUNDS);

	await db.transaction(async (tx) => {
		const now = new Date();

		const [userRecord] = await tx
			.insert(users)
			.values({
				walletAddress: payerAddress,
				network,
				email,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [users.walletAddress, users.network],
				set: {
					email,
					updatedAt: now,
				},
			})
			.returning({
				id: users.id,
			});

		const userId = userRecord?.id;

		if (!userId) {
			throw new Error("Failed to persist x402 user");
		}

		await tx
			.insert(orders)
			.values({
				id: orderId,
				userId,
				network,
				clientSecret: hashedSecret,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: orders.id,
				set: {
					userId,
					network,
					clientSecret: hashedSecret,
					updatedAt: now,
				},
			});
	});

	console.log("[orders] Persisted order record", {
		orderId,
	});
};

export const getOrderStatusHandler = async (c: Context) => {
	const orderId = c.req.param("orderId");
	const paramsParsed = getOrderStatusParamsSchema.safeParse({ orderId });

	if (!paramsParsed.success) {
		return c.json(
			{
				error: "Invalid order ID format",
				issues: paramsParsed.error.flatten(),
			},
			400,
		);
	}

	const authorization = c.req.header("Authorization");
	const headersParsed = getOrderStatusHeadersSchema.safeParse({
		authorization,
	});

	if (!headersParsed.success) {
		return c.json(
			{
				error: "Authorization header is required",
				issues: headersParsed.error.flatten(),
			},
			401,
		);
	}

	console.log("[orders] Fetching order status", {
		orderId: paramsParsed.data.orderId,
		hasAuth: Boolean(authorization),
	});

	const [orderRecord] = await db
		.select({
			clientSecret: orders.clientSecret,
		})
		.from(orders)
		.where(eq(orders.id, paramsParsed.data.orderId))
		.limit(1);

	if (!orderRecord) {
		console.log("[orders] Order not found in database", {
			orderId: paramsParsed.data.orderId,
		});
		return c.json(
			{
				error: "Order not found",
				orderId: paramsParsed.data.orderId,
			},
			404,
		);
	}

	let isValidSecret = false;
	try {
		const sha256Hash = hashClientSecret(headersParsed.data.authorization);
		isValidSecret = await bcrypt.compare(sha256Hash, orderRecord.clientSecret);
	} catch (bcryptError) {
		console.error("[orders] Bcrypt comparison error", {
			orderId: paramsParsed.data.orderId,
			error:
				bcryptError instanceof Error
					? bcryptError.message
					: String(bcryptError),
		});
		isValidSecret = false;
	}

	if (!isValidSecret) {
		console.log("[orders] Invalid client secret", {
			orderId: paramsParsed.data.orderId,
		});
		return c.json(
			{
				error: "Invalid client secret or access denied",
			},
			403,
		);
	}

	try {
		const orderStatus = await getCrossmintOrder(paramsParsed.data.orderId);

		console.log("[orders] Order status retrieved successfully", {
			orderId: orderStatus.orderId,
			phase: orderStatus.phase,
			paymentStatus: orderStatus.payment?.status,
			deliveryStatus: orderStatus.lineItems?.[0]?.delivery?.status,
		});

		return c.json(orderStatus, 200);
	} catch (error) {
		if (error instanceof CrossmintGetOrderError) {
			console.error("[orders] Failed to fetch order status", {
				orderId: paramsParsed.data.orderId,
				message: error.message,
				status: error.status,
				details: error.details,
			});

			if (error.status === 404) {
				return c.json(
					{
						error: "Order not found",
						orderId: paramsParsed.data.orderId,
					},
					404,
				);
			}

			if (error.status === 403) {
				return c.json(
					{
						error: "Invalid client secret or access denied",
					},
					403,
				);
			}

			return c.json(
				{
					error: error.message,
					details: error.details,
				},
				error.status,
			);
		}

		console.error("[orders] Unexpected error fetching order status", {
			orderId: paramsParsed.data.orderId,
			error,
		});

		return c.json(
			{
				error: "Failed to fetch order status",
			},
			500,
		);
	}
};

export const buildCreateOrderHandler =
	<TSchema extends ZodType<CreateOrderPayload>>(
		config: CreateOrderHandlerConfig<TSchema>,
	) =>
	async (c: Context) => {
		let payload = c.get("validatedBody") as CreateOrderPayload;

		if (!payload) {
			let rawBody: unknown;

			try {
				rawBody = await c.req.json();
			} catch {
				return c.json(
					{
						error: "Invalid JSON payload",
					},
					400,
				);
			}

			const parsed = config.schema.safeParse(rawBody);

			if (!parsed.success) {
				return c.json(
					{
						error: "Invalid request body",
						issues: parsed.error.flatten(),
					},
					400,
				);
			}

			payload = parsed.data;
		}

		const { email, payerAddress, locale, physicalAddress, productUrl } =
			payload;

		console.log("[orders] Received create order request", {
			paymentMethod: config.paymentMethod,
			email,
			payerAddress,
			locale,
			productUrl,
			physicalAddress,
		});

		try {
			const response = await createCrossmintOrder({
				email,
				payerAddress,
				locale,
				physicalAddress,
				productUrl,
				paymentMethod: config.paymentMethod,
			});

			try {
				await saveOrderRecord({
					orderId: response.order.orderId,
					email,
					payerAddress,
					network: config.paymentMethod,
					clientSecret: response.clientSecret,
				});
			} catch (databaseError) {
				console.error("[orders] Failed to persist order record", {
					orderId: response.order.orderId,
					error:
						databaseError instanceof Error
							? databaseError.message
							: String(databaseError),
				});

				return c.json(
					{
						error: "Failed to persist order record",
					},
					500,
				);
			}

			const preparation = response.order.payment?.preparation;
			const serializedTransaction = preparation?.serializedTransaction;

			console.log("[orders] Crossmint order created", {
				orderId: response.order.orderId,
				clientSecretPresent: Boolean(response.clientSecret),
				paymentStatus: response.order.payment?.status,
				quoteStatus: response.order.quote?.status,
				hasSerializedTransaction: Boolean(serializedTransaction),
			});

			return c.json(
				{
					clientSecret: response.clientSecret,
					orderId: response.order.orderId,
					serializedTransaction: serializedTransaction ?? null,
					payerAddress: preparation?.payerAddress ?? payerAddress,
					chain: preparation?.chain ?? config.paymentMethod,
					paymentStatus: response.order.payment?.status,
					paymentCurrency: response.order.payment?.currency,
					quote: response.order.quote,
					lineItems: response.order.lineItems,
					order: response.order,
				},
				201,
			);
		} catch (error) {
			if (error instanceof CrossmintOrderError) {
				console.error("[orders] Crossmint order error", {
					message: error.message,
					status: error.status,
					details: error.details,
				});

				return c.json(
					{
						error: error.message,
						details: error.details,
					},
					error.status,
				);
			}

			console.error("Unexpected error creating Crossmint order", error);

			console.error("[orders] Unexpected create order failure", {
				paymentMethod: config.paymentMethod,
				error,
			});

			return c.json(
				{
					error: "Failed to create Crossmint order",
				},
				502,
			);
		}
	};

import type { Context } from "hono";
import type { ZodType } from "zod";
import { db } from "../db/client";
import { orders, users, type X402Network } from "../db/schema";
import {
	CrossmintOrderError,
	createCrossmintOrder,
	type PhysicalAddress,
} from "./createCrossmintOrder";

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
}

const saveOrderRecord = async ({
	orderId,
	email,
	payerAddress,
	network,
}: SaveOrderParams) => {
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
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: orders.id,
				set: {
					userId,
					network,
					updatedAt: now,
				},
			});
	});

	console.log("[orders] Persisted order record", {
		orderId,
	});
};

export const buildCreateOrderHandler =
	<TSchema extends ZodType<CreateOrderPayload>>(
		config: CreateOrderHandlerConfig<TSchema>,
	) =>
	async (c: Context) => {
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

		const payload = parsed.data;
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

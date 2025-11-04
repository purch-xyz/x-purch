import type { Context } from "hono";
import type { ZodType } from "zod";
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
	paymentMethod: string;
}

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

		const data = parsed.data;
		const { email, payerAddress, locale, physicalAddress, productUrl } = data;

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

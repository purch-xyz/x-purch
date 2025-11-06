import { z } from "zod";

const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const physicalAddressSchema = z.object({
	name: z.string().min(1),
	line1: z.string().min(1),
	line2: z.string().optional(),
	city: z.string().min(1),
	state: z.string().optional(),
	postalCode: z.string().min(1),
	country: z
		.string()
		.length(2)
		.transform((value) => value.toUpperCase()),
});

const baseRequestSchema = z.object({
	email: z.string().email(),
	locale: z.string().optional(),
	physicalAddress: physicalAddressSchema,
	productUrl: z.string().url(),
});

export const solanaCreateOrderSchema = baseRequestSchema.extend({
	payerAddress: z
		.string()
		.regex(
			solanaAddressRegex,
			"payerAddress must be a valid Solana public key",
		),
});

export const getOrderStatusParamsSchema = z.object({
	orderId: z.string().uuid(),
});

export const getOrderStatusHeadersSchema = z.object({
	authorization: z.string().min(1),
});

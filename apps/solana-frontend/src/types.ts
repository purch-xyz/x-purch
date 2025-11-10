export interface CrossmintOrderResponse {
	clientSecret: string | null;
	orderId: string;
	serializedTransaction: string | null;
	payerAddress: string | null;
	chain: string | null;
	paymentStatus?: string | null;
	paymentCurrency?: string | null;
	quote?: unknown;
	lineItems?: unknown;
	order?: unknown;
}

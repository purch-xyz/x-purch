import { env } from "../env";

const CROSSMINT_ORDERS_PATH = "/2022-06-09/orders";

export interface CrossmintOrderStatus {
	orderId: string;
	phase: "payment" | "delivery" | "completed";
	locale?: string;
	lineItems?: Array<{
		chain?: string;
		quantity?: number;
		metadata?: {
			name?: string;
			description?: string;
			imageUrl?: string;
		};
		quote?: {
			status: string;
			charges?: {
				unit?: {
					amount: string;
					currency: string;
				};
				salesTax?: {
					amount: string;
					currency: string;
				};
				shipping?: {
					amount: string;
					currency: string;
				};
			};
			totalPrice?: {
				amount: string;
				currency: string;
			};
		};
		delivery?: {
			status: "awaiting-payment" | "in-progress" | "completed" | "failed";
			txId?: string;
			recipient?: {
				locator?: string;
				email?: string;
				walletAddress?: string;
			};
		};
	}>;
	quote?: {
		status:
			| "valid"
			| "expired"
			| "all-line-items-unavailable"
			| "requires-physical-address";
		quotedAt?: string;
		expiresAt?: string;
		totalPrice?: {
			amount: string;
			currency: string;
		};
	};
	payment?: {
		status:
			| "requires-kyc"
			| "failed-kyc"
			| "manual-kyc"
			| "awaiting-payment"
			| "requires-recipient"
			| "requires-crypto-payer-address"
			| "failed"
			| "in-progress"
			| "completed";
		method?: string;
		currency?: string;
		preparation?: {
			chain?: string;
			payerAddress?: string;
			serializedTransaction?: string;
		};
	};
}

export class CrossmintGetOrderError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "CrossmintGetOrderError";
	}
}

export const getCrossmintOrder = async (
	orderId: string,
): Promise<CrossmintOrderStatus> => {
	const baseUrl = env.CROSSMINT_API_BASE_URL ?? "https://www.crossmint.com/api";
	const url = `${baseUrl}${CROSSMINT_ORDERS_PATH}/${orderId}`;

	console.log("[getCrossmintOrder] Fetching order status", {
		orderId,
		url,
	});

	const response = await fetch(url, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": env.CROSSMINT_API_KEY,
		},
	});

	const contentType = response.headers.get("content-type") ?? "";
	const isJson = contentType.includes("application/json");
	const responseBody = isJson ? await response.json() : await response.text();

	console.log("[getCrossmintOrder] Received response", {
		orderId,
		status: response.status,
		ok: response.ok,
		contentType,
	});

	if (!response.ok) {
		console.error("[getCrossmintOrder] Request failed", {
			orderId,
			status: response.status,
			body: responseBody,
		});

		const message =
			typeof responseBody === "string"
				? responseBody || "Failed to fetch order status"
				: (responseBody?.message ?? "Failed to fetch order status");

		throw new CrossmintGetOrderError(message, response.status, responseBody);
	}

	const parsed = responseBody as Partial<CrossmintOrderStatus>;

	if (!parsed?.orderId) {
		console.error("[getCrossmintOrder] Unexpected response shape", {
			orderId,
			responseBody,
		});

		throw new CrossmintGetOrderError(
			"Unexpected Crossmint response shape",
			502,
			responseBody,
		);
	}

	console.log("[getCrossmintOrder] Order status fetched successfully", {
		orderId: parsed.orderId,
		phase: parsed.phase,
		paymentStatus: parsed.payment?.status,
		deliveryStatus: parsed.lineItems?.[0]?.delivery?.status,
		quoteStatus: parsed.quote?.status,
	});

	return parsed as CrossmintOrderStatus;
};

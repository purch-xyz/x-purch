import { env } from "../env";

const DEFAULT_LOCALE = "en-US";
const CROSSMINT_ORDERS_PATH = "/2022-06-09/orders";
const CROSSMINT_CURRENCY = "usdc";

export interface PhysicalAddress {
	name: string;
	line1: string;
	line2?: string;
	city: string;
	state?: string;
	postalCode: string;
	country: string;
}

export interface CreateCrossmintOrderArgs {
	email: string;
	payerAddress: string;
	locale?: string;
	physicalAddress: PhysicalAddress;
	productUrl: string;
	paymentMethod: string;
}

interface CrossmintOrderPaymentPreparation {
	chain: string;
	payerAddress: string;
	serializedTransaction: string;
}

interface CrossmintOrderPayment {
	status: string;
	method: string;
	currency: string;
	preparation?: CrossmintOrderPaymentPreparation;
}

interface CrossmintOrderQuote {
	status: string;
	totalPrice?: {
		amount: string;
		currency: string;
	};
}

interface CrossmintOrderLineItem {
	chain?: string;
	metadata?: {
		name?: string;
		description?: string;
		imageUrl?: string;
	};
}

export interface CrossmintOrderResponse {
	clientSecret: string;
	order: {
		orderId: string;
		payment?: CrossmintOrderPayment;
		quote?: CrossmintOrderQuote;
		lineItems?: CrossmintOrderLineItem[];
	};
}

export class CrossmintOrderError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "CrossmintOrderError";
	}
}

export const createCrossmintOrder = async (
	args: CreateCrossmintOrderArgs,
): Promise<CrossmintOrderResponse> => {
	const {
		email,
		payerAddress,
		locale = DEFAULT_LOCALE,
		physicalAddress,
		productUrl,
		paymentMethod,
	} = args;

	const productLocator = extractAmazonProductLocator(productUrl);

	const baseUrl = env.CROSSMINT_API_BASE_URL ?? "https://www.crossmint.com/api";

	const body = {
		recipient: {
			email,
			physicalAddress,
		},
		locale,
		payment: {
			receiptEmail: email,
			method: paymentMethod,
			currency: CROSSMINT_CURRENCY,
			payerAddress,
		},
		lineItems: {
			productLocator,
		},
	};

	const response = await fetch(`${baseUrl}${CROSSMINT_ORDERS_PATH}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-API-KEY": env.CROSSMINT_API_KEY,
		},
		body: JSON.stringify(body),
	});

	const contentType = response.headers.get("content-type") ?? "";
	const isJson = contentType.includes("application/json");
	const responseBody = isJson ? await response.json() : await response.text();

	if (!response.ok) {
		const message =
			typeof responseBody === "string"
				? responseBody || "Crossmint order creation failed"
				: (responseBody?.message ?? "Crossmint order creation failed");
		throw new CrossmintOrderError(message, response.status, responseBody);
	}

	const parsed = responseBody as Partial<CrossmintOrderResponse>;

	if (!parsed?.clientSecret || !parsed?.order?.orderId) {
		throw new CrossmintOrderError(
			"Unexpected Crossmint response shape",
			502,
			responseBody,
		);
	}

	return parsed as CrossmintOrderResponse;
};

const amazonAsinRegex = /[/=]([A-Z0-9]{10})(?:[/?]|$)/i;

const extractAmazonProductLocator = (productUrl: string): string => {
	const asinMatch = productUrl.match(amazonAsinRegex);
	const asin = asinMatch?.[1]?.toUpperCase();

	if (!asin) {
		throw new CrossmintOrderError(
			"Unable to extract Amazon ASIN from productUrl",
			400,
		);
	}

	return `amazon:${asin}`;
};

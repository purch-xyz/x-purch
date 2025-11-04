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

	const baseUrl = env.CROSSMINT_API_BASE_URL ?? "https://www.crossmint.com/api";

	const productLocator = await resolveProductLocator(productUrl);

	console.log("[createCrossmintOrder] Preparing Crossmint request", {
		baseUrl,
		path: CROSSMINT_ORDERS_PATH,
		paymentMethod,
		email,
		payerAddress,
		locale,
		productUrl,
		productLocator,
		hasPhysicalAddress: Boolean(physicalAddress),
	});

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
		lineItems: [
			{
				productLocator,
			},
		],
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

	console.log("[createCrossmintOrder] Received Crossmint response", {
		status: response.status,
		ok: response.ok,
		contentType,
	});

	if (!response.ok) {
		console.error("[createCrossmintOrder] Crossmint request failed", {
			status: response.status,
			body: responseBody,
		});

		const message =
			typeof responseBody === "string"
				? responseBody || "Crossmint order creation failed"
				: (responseBody?.message ?? "Crossmint order creation failed");
		throw new CrossmintOrderError(message, response.status, responseBody);
	}

	const parsed = responseBody as Partial<CrossmintOrderResponse>;

	if (!parsed?.clientSecret || !parsed?.order?.orderId) {
		console.error("[createCrossmintOrder] Unexpected response shape", {
			responseBody,
		});

		throw new CrossmintOrderError(
			"Unexpected Crossmint response shape",
			502,
			responseBody,
		);
	}

	console.log("[createCrossmintOrder] Crossmint request succeeded", {
		orderId: parsed.order.orderId,
		hasClientSecret: Boolean(parsed.clientSecret),
		paymentStatus: parsed.order.payment?.status,
		lineItems: parsed.order.lineItems,
	});

	return parsed as CrossmintOrderResponse;
};

const PLATFORM_HOSTNAMES = {
	amazon: ["amazon."],
	shopify: ["myshopify.com"],
	browserAutomation: [
		"nike.com",
		"www.nike.com",
		"adidas.com",
		"www.adidas.com",
		"crocs.com",
		"www.crocs.com",
		"gymshark.com",
		"www.gymshark.com",
		"on.com",
		"www.on.com",
	],
} as const;

const PRODUCT_LOCATOR_PREFIXES = ["amazon:", "shopify:", "url:"] as const;

const SHOPIFY_HEADER_PREFIXES = ["x-shopify"] as const;

export const resolveProductLocator = async (
	rawProductUrl: string,
): Promise<string> => {
	const trimmed = rawProductUrl.trim();

	if (!trimmed) {
		throw new CrossmintOrderError("Product URL is required", 400);
	}

	const existingPrefix = PRODUCT_LOCATOR_PREFIXES.find((prefix) =>
		trimmed.toLowerCase().startsWith(prefix),
	);

	if (existingPrefix) {
		return trimmed;
	}

	let parsedUrl: URL;

	try {
		parsedUrl = new URL(trimmed);
	} catch {
		throw new CrossmintOrderError("Product URL must be a valid URL", 400);
	}

	const hostname = parsedUrl.hostname.toLowerCase();

	if (PLATFORM_HOSTNAMES.amazon.some((domain) => hostname.includes(domain))) {
		return `amazon:${trimmed}`;
	}

	if (PLATFORM_HOSTNAMES.shopify.some((domain) => hostname.includes(domain))) {
		return buildShopifyLocator(parsedUrl);
	}

	const isBrowserAutomationDomain = PLATFORM_HOSTNAMES.browserAutomation.some(
		(domain) => hostname === domain || hostname.endsWith(`.${domain}`),
	);

	if (isBrowserAutomationDomain) {
		return `url:${trimmed}`;
	}

	const detectedShopify = await isShopifyStorefront(parsedUrl);

	if (detectedShopify) {
		return buildShopifyLocator(parsedUrl);
	}

	return `url:${trimmed}`;
};

const isShopifyStorefront = async (url: URL): Promise<boolean> => {
	const hostname = url.hostname.toLowerCase();

	if (PLATFORM_HOSTNAMES.shopify.some((domain) => hostname.includes(domain))) {
		return true;
	}

	const requestUrl = url.toString();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);

	const inspectHeaders = (headers: Headers) => {
		for (const [key, value] of headers.entries()) {
			const loweredKey = key.toLowerCase();
			const loweredValue = value.toLowerCase();

			if (
				SHOPIFY_HEADER_PREFIXES.some((prefix) => loweredKey.startsWith(prefix))
			) {
				return true;
			}

			if (loweredValue.includes("shopify")) {
				return true;
			}
		}

		return false;
	};

	const tryFetch = async (method: "HEAD" | "GET") => {
		try {
			const response = await fetch(requestUrl, {
				method,
				redirect: "follow",
				signal: controller.signal,
			});

			if (inspectHeaders(response.headers)) {
				return true;
			}

			return false;
		} catch (error) {
			console.warn("[createCrossmintOrder] Failed to inspect product URL", {
				requestUrl,
				method,
				error,
			});
			return false;
		}
	};

	try {
		const headDetected = await tryFetch("HEAD");

		if (headDetected) {
			return true;
		}

		return await tryFetch("GET");
	} finally {
		clearTimeout(timeout);
	}
};

const buildShopifyLocator = (url: URL): string => {
	const variantId = url.searchParams.get("variant");

	if (!variantId) {
		throw new CrossmintOrderError(
			"Shopify product URL must include variant parameter",
			400,
		);
	}

	const normalizedParams = new URLSearchParams(url.search);
	normalizedParams.delete("variant");
	const query = normalizedParams.toString();
	const normalizedUrl = `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;

	return `shopify:${normalizedUrl}:${variantId}`;
};

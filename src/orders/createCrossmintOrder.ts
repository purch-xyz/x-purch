import { isIP } from "node:net";
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

const SHORT_URL_HOSTNAMES = ["a.co", "amzn.to", "amzn.com", "bit.ly", "t.co"];

const BLOCKED_HOSTNAMES = ["localhost"] as const;
const BLOCKED_HOST_SUFFIXES = [
	".localhost",
	".local",
	".localdomain",
	".internal",
] as const;

const SHOPIFY_PRODUCT_PATH = "/products/";

const isHostnameBlocked = (hostname: string): boolean => {
	return (
		BLOCKED_HOSTNAMES.includes(
			hostname as (typeof BLOCKED_HOSTNAMES)[number],
		) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
	);
};

const validateProductUrl = (url: URL): void => {
	const hostname = url.hostname.toLowerCase();

	if (url.protocol !== "https:") {
		throw new CrossmintOrderError("Product URL must use https", 400);
	}

	if (!hostname || url.username || url.password || url.port) {
		throw new CrossmintOrderError("Product URL is invalid", 400);
	}

	if (isIP(hostname) !== 0 || isHostnameBlocked(hostname)) {
		throw new CrossmintOrderError("Product URL host is not allowed", 400);
	}
};

const expandShortUrl = async (url: string): Promise<string | null> => {
	let parsedUrl: URL;

	try {
		parsedUrl = new URL(url);
	} catch {
		return null;
	}

	validateProductUrl(parsedUrl);

	const hostname = parsedUrl.hostname.toLowerCase();
	const isShortUrl = SHORT_URL_HOSTNAMES.some(
		(domain) => hostname === domain || hostname.endsWith(`.${domain}`),
	);

	if (!isShortUrl) {
		return null;
	}

	try {
		const response = await fetch(url, {
			method: "HEAD",
			redirect: "follow",
			signal: AbortSignal.timeout(5000),
		});

		const finalUrl = response.url;

		if (finalUrl && finalUrl !== url) {
			validateProductUrl(new URL(finalUrl));
			console.log("[resolveProductLocator] Expanded short URL", {
				original: url,
				resolved: finalUrl,
			});
			return finalUrl;
		}

		return null;
	} catch (error) {
		console.warn("[resolveProductLocator] Failed to expand short URL", {
			url,
			error,
		});
		return null;
	}
};

export const resolveProductLocator = async (
	rawProductUrl: string,
): Promise<string> => {
	const trimmed = rawProductUrl.trim();

	if (!trimmed) {
		throw new CrossmintOrderError("Product URL is required", 400);
	}

	let parsedUrl: URL;

	try {
		parsedUrl = new URL(trimmed);
	} catch {
		throw new CrossmintOrderError("Product URL must be a valid URL", 400);
	}

	validateProductUrl(parsedUrl);

	const expandedUrl = await expandShortUrl(trimmed);
	const resolvedUrl = expandedUrl ?? trimmed;
	const resolvedParsed = expandedUrl ? new URL(expandedUrl) : parsedUrl;
	validateProductUrl(resolvedParsed);
	const hostname = resolvedParsed.hostname.toLowerCase();

	if (PLATFORM_HOSTNAMES.amazon.some((domain) => hostname.includes(domain))) {
		return `amazon:${resolvedUrl}`;
	}

	if (
		PLATFORM_HOSTNAMES.shopify.some((domain) => hostname.includes(domain)) ||
		resolvedParsed.pathname.includes(SHOPIFY_PRODUCT_PATH)
	) {
		return buildShopifyLocator(resolvedParsed);
	}

	const isBrowserAutomationDomain = PLATFORM_HOSTNAMES.browserAutomation.some(
		(domain) => hostname === domain || hostname.endsWith(`.${domain}`),
	);

	if (isBrowserAutomationDomain) {
		return `url:${resolvedUrl}`;
	}

	return `url:${resolvedUrl}`;
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

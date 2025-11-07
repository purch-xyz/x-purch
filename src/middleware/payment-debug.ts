import type { MiddlewareHandler } from "hono";

export const createPaymentDebugMiddleware = (): MiddlewareHandler => {
	return async (c, next) => {
		const paymentHeader = c.req.header("X-PAYMENT");

		if (paymentHeader) {
			console.log("[x402-debug] Payment header received:", {
				length: paymentHeader.length,
				prefix: paymentHeader.substring(0, 50),
			});
		}

		const originalJson = c.json.bind(c);
		c.json = (object: unknown, status?: number) => {
			if (status === 402) {
				console.log("[x402-debug] Returning 402 response:", {
					hasXPaymentHeader: !!c.res.headers.get("X-PAYMENT"),
					responseHeaders: Object.fromEntries(c.res.headers.entries()),
				});
			}
			return originalJson(object, status);
		};

		try {
			await next();
		} catch (error) {
			console.error("[x402-debug] Middleware error:", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}

		if (c.res.status === 402 && paymentHeader) {
			console.warn(
				"[x402-debug] Payment validation failed - returning 402 despite payment header present",
			);
		}
	};
};

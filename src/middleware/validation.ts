import type { Context, MiddlewareHandler, Next } from "hono";
import { type ZodType, z } from "zod";

export const createValidationMiddleware = <T>(
	schema: ZodType<T>,
): MiddlewareHandler => {
	return async (c: Context, next: Next) => {
		const method = c.req.method.toUpperCase();
		if (!["POST", "PUT", "PATCH"].includes(method)) {
			return next();
		}

		let rawBody: unknown;

		try {
			const clonedRequest = c.req.raw.clone();
			rawBody = await clonedRequest.json();
		} catch {
			return c.json(
				{
					error: "Invalid JSON payload",
				},
				400,
			);
		}

		const parsed = schema.safeParse(rawBody);

		if (!parsed.success) {
			const treeifiedError = z.treeifyError(parsed.error);

			console.log("[validation] Request body validation failed", {
				path: c.req.path,
				method: c.req.method,
				errors: treeifiedError,
			});

			return c.json(
				{
					error: "Invalid request body",
					details: treeifiedError,
				},
				400,
			);
		}

		console.log("[validation] Request body validation successful", {
			path: c.req.path,
			method: c.req.method,
		});

		c.set("validatedBody", parsed.data);

		await next();
	};
};

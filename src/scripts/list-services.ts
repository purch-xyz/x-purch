import { facilitator } from "@coinbase/x402";
import { useFacilitator } from "x402/verify";

const { list } = useFacilitator(facilitator);

type ServiceListResponse = {
	items?: {
		accepts?: {
			network?: string;
		}[];
		[key: string]: unknown;
	}[];
	pagination?: {
		limit: number;
		offset: number;
		total: number;
	};
	[key: string]: unknown;
};

const parseArg = (name: string, fallback?: string) => {
	const prefix = `--${name}=`;
	const arg = Bun.argv.slice(2).find((a) => a.startsWith(prefix));
	if (arg) return arg.slice(prefix.length);
	return fallback;
};

const parseNumber = (value: string | undefined, fallback: number) => {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? fallback : parsed;
};

const MAX_PAGE_SIZE = 500;

const network = (parseArg("network") ?? "solana").toLowerCase();
const targetLimit = Math.max(1, parseNumber(parseArg("limit"), 100000));
const requestedPageSize = parseNumber(parseArg("pageSize"), MAX_PAGE_SIZE);
const pageSize = Math.max(
	1,
	Math.min(requestedPageSize, MAX_PAGE_SIZE, targetLimit),
);
let offset = Math.max(0, parseNumber(parseArg("offset"), 0));
const outputPath = parseArg("output") ?? `services-${network}.json`;

try {
	const items: unknown[] = [];
	let totalAvailable = Infinity;
	let lastResponse: ServiceListResponse | undefined;

	while (items.length < targetLimit && offset < totalAvailable) {
		const remaining = targetLimit - items.length;
		const pageLimit = remaining > pageSize ? pageSize : Math.max(1, remaining);
		const response = (await list({
			limit: pageLimit,
			offset,
		})) as ServiceListResponse;
		lastResponse = response;
		const pageItems = Array.isArray(response.items) ? response.items : [];
		if (pageItems.length === 0) break;
		const filteredPageItems = pageItems.filter((item) =>
			item.accepts?.some((req) => req.network?.toLowerCase() === network),
		);
		if (filteredPageItems.length > 0) {
			const remaining = targetLimit - items.length;
			items.push(...filteredPageItems.slice(0, remaining));
		}
		const pagination = response.pagination;
		if (pagination) {
			totalAvailable = pagination.total ?? items.length;
			offset = pagination.offset + pagination.limit;
		} else {
			offset += pageItems.length;
			break;
		}
	}

	const services: ServiceListResponse = lastResponse
		? { ...lastResponse, items }
		: { items };
	const pagination = lastResponse?.pagination;
	services.pagination = {
		limit: items.length,
		offset: 0,
		total: pagination?.total ?? items.length,
	};

	await Bun.write(outputPath, JSON.stringify(services, null, 2));
	const count = items.length;
	console.log(`Saved ${count} ${network} services to ${outputPath}`);
} catch (error) {
	console.error("Failed to list services", {
		error: error instanceof Error ? error.message : String(error),
	});
	process.exit(1);
}

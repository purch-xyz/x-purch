import {
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const x402Network = pgEnum("x402_network", ["solana", "base"]);
export type X402Network = (typeof x402Network.enumValues)[number];

export const users = pgTable(
	"users_x402",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		walletAddress: text("wallet_address").notNull(),
		network: x402Network("network").notNull(),
		email: text("email"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => ({
		walletAddressNetworkKey: uniqueIndex("users_x402_wallet_network_key").on(
			table.walletAddress,
			table.network,
		),
	}),
);

export const orders = pgTable("orders_x402", {
	id: uuid("id").primaryKey().notNull(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	network: x402Network("network").notNull(),
	clientSecret: text("client_secret").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

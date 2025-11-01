import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const orders = pgTable("orders", {
	id: uuid("id").primaryKey(),
	status: text("status").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

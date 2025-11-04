CREATE TYPE "public"."x402_network" AS ENUM('solana', 'base');--> statement-breakpoint
CREATE TABLE "orders_x402" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"network" "x402_network" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users_x402" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"network" "x402_network" NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders_x402" ADD CONSTRAINT "orders_x402_user_id_users_x402_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_x402"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_x402_wallet_network_key" ON "users_x402" USING btree ("wallet_address","network");
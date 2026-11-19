ALTER TABLE "guild_config" ADD COLUMN "default_ping_role_id" text;--> statement-breakpoint
ALTER TABLE "guild_config" ADD COLUMN "admin_role_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_config" ADD COLUMN "manager_role_ids" text[] DEFAULT '{}' NOT NULL;
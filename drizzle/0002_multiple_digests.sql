CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"channel_id" text NOT NULL,
	"weekday" integer DEFAULT 7 NOT NULL,
	"hour" integer,
	"teams" text[] DEFAULT '{}' NOT NULL,
	"project_id" integer,
	"ping_mode" text DEFAULT 'auto' NOT NULL,
	"ping_role_id" text,
	"last_sent_on" date,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digests_guild_name" ON "digests" USING btree ("guild_id","name");--> statement-breakpoint
ALTER TABLE "guild_config" DROP COLUMN "digest_channel_id";--> statement-breakpoint
ALTER TABLE "guild_config" DROP COLUMN "last_digest_on";
CREATE TABLE "artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"added_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_config" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"reminder_hour" integer DEFAULT 9 NOT NULL,
	"reminder_channel_ids" text[] DEFAULT '{}' NOT NULL,
	"digest_channel_id" text,
	"last_digest_on" date,
	"checkin_channel_id" text,
	"checkin_weekday" integer,
	"last_checkin_on" date,
	"team_roles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"team_channels" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"due_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lead_id" text NOT NULL,
	"member_ids" text[] DEFAULT '{}' NOT NULL,
	"teams" text[] DEFAULT '{}' NOT NULL,
	"term" text,
	"color" text DEFAULT 'blue' NOT NULL,
	"channel_ids" text[] DEFAULT '{}' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"link" text,
	"due_at" timestamp with time zone NOT NULL,
	"due_has_time" boolean DEFAULT false NOT NULL,
	"owner_ids" text[] DEFAULT '{}' NOT NULL,
	"teams" text[] DEFAULT '{}' NOT NULL,
	"term" text NOT NULL,
	"project_id" integer,
	"milestone_id" integer,
	"color" text,
	"status" text DEFAULT 'open' NOT NULL,
	"blocker_note" text,
	"channel_ids" text[] DEFAULT '{}' NOT NULL,
	"snoozed_until" date,
	"last_reminded_on" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_guild_name" ON "projects" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "tasks_guild_status_due" ON "tasks" USING btree ("guild_id","status","due_at");
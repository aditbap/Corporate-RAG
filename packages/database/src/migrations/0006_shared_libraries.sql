-- Shared libraries: orgs gain a kind/description/creator, memberships become
-- unique per (user, org), and invite codes let members join a shared library.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'personal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "created_by" uuid;
--> statement-breakpoint
-- Collapse any pre-existing duplicate memberships before adding the unique index.
DELETE FROM "memberships" a USING "memberships" b
  WHERE a."user_id" = b."user_id" AND a."org_id" = b."org_id" AND a."created_at" > b."created_at";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_user_org_unique" ON "memberships" ("user_id", "org_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "code" varchar(64) NOT NULL UNIQUE,
  "role" "membership_role" DEFAULT 'member' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone,
  "max_uses" integer,
  "use_count" integer DEFAULT 0 NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_library_invites_org" ON "library_invites" ("org_id");

-- Identity is the IdP `sub` (users.id). A recreated IdP account can reuse an email with a new
-- `sub`; a unique email then made first-login provisioning fail with a constraint error.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

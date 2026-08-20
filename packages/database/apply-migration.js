import postgres from 'postgres';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL);

async function main() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "folders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "org_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "parent_id" uuid,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `;
    console.log('Created folders table');

    try {
      await sql`ALTER TABLE "documents" ADD COLUMN "folder_id" uuid;`;
      console.log('Added folder_id column to documents');
    } catch (e) {
      console.log('Column folder_id might already exist');
    }
    
    try {
      await sql`ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE set null ON UPDATE no action;`;
      console.log('Added FK to documents');
    } catch(e) { console.log('FK might already exist') }

    try {
      await sql`ALTER TABLE "folders" ADD CONSTRAINT "folders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;`;
      console.log('Added FK to folders (org_id)');
    } catch(e) { console.log('FK might already exist') }

    try {
      await sql`ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE cascade ON UPDATE no action;`;
      console.log('Added FK to folders (parent_id)');
    } catch(e) { console.log('FK might already exist') }

    console.log('Migration complete');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
main();

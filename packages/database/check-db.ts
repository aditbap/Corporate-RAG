import { db, conversations } from './src/index';
async function main() {
  const result = await db.select().from(conversations);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(console.error);

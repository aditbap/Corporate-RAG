import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

// Setup connection string
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/rag_platform';

// Create postgres connection pool
export const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
});

// Initialize drizzle
export const db = drizzle(queryClient, { schema });

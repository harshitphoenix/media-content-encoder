import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  return drizzle(sql, { schema, logger: false });
}

// Re-export schema for query access
export { schema };
export * from './schema.js';

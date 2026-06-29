import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const db = createDb(url);

console.log('Running migrations...');
await migrate(db, { migrationsFolder: join(__dirname, '..', 'migrations') });
console.log('Migrations complete.');
process.exit(0);

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { loadDatabaseUrl } from '../config/env.js';
import { createDb } from './client.js';

export const MIGRATIONS_FOLDER = path.join(import.meta.dirname, 'migrations');

export async function runMigrations(url: string): Promise<void> {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

if (import.meta.filename === process.argv[1]) {
  await runMigrations(loadDatabaseUrl());
  console.warn('migrations applied');
}

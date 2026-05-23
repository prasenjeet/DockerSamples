/**
 * Init Container: DB Migrator
 *
 * Pattern: Init containers run to completion BEFORE the main app starts.
 * This container:
 *   1. Polls until PostgreSQL accepts connections (dependency readiness check)
 *   2. Creates the schema (idempotent migrations)
 *   3. Seeds initial data if the table is empty
 *   4. Exits with code 0 — signaling the main app container to start
 *
 * In Kubernetes, initContainers[] run sequentially before containers[].
 * In Docker Compose, this is approximated with depends_on + condition: service_completed_successfully.
 */

const { Client } = require('pg');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'notesdb',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '30');
const RETRY_INTERVAL_MS = parseInt(process.env.RETRY_INTERVAL_MS || '2000');

async function waitForDatabase() {
  console.log(`[init-db-migrator] Waiting for PostgreSQL at ${DB_CONFIG.host}:${DB_CONFIG.port}...`);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new Client(DB_CONFIG);
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      console.log(`[init-db-migrator] PostgreSQL is ready (attempt ${attempt})`);
      return;
    } catch (err) {
      console.log(`[init-db-migrator] Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      await client.end().catch(() => {});
      if (attempt === MAX_RETRIES) {
        throw new Error('PostgreSQL did not become ready in time');
      }
      await sleep(RETRY_INTERVAL_MS);
    }
  }
}

async function runMigrations(client) {
  console.log('[init-db-migrator] Running migrations...');

  // Migration 001: create notes table
  await client.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id          UUID PRIMARY KEY,
      title       VARCHAR(255) NOT NULL,
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migration 002: create migrations tracking table
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(50) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrations = [
    { version: '001_create_notes', sql: null }, // already applied above
    {
      version: '002_add_tags_column',
      sql: `ALTER TABLE notes ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`,
    },
  ];

  for (const migration of migrations) {
    const { rowCount } = await client.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [migration.version]
    );
    if (rowCount > 0) {
      console.log(`[init-db-migrator] Migration ${migration.version}: already applied, skipping`);
      continue;
    }
    if (migration.sql) {
      await client.query(migration.sql);
    }
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1)',
      [migration.version]
    );
    console.log(`[init-db-migrator] Migration ${migration.version}: applied`);
  }

  console.log('[init-db-migrator] All migrations complete');
}

async function seedData(client) {
  const { rowCount } = await client.query('SELECT 1 FROM notes LIMIT 1');
  if (rowCount > 0) {
    console.log('[init-db-migrator] Database already seeded, skipping');
    return;
  }

  console.log('[init-db-migrator] Seeding initial data...');
  const seeds = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Welcome to Notes App',
      content: 'This app was initialized by an init container that set up the database schema.',
      tags: ['welcome', 'init-container'],
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      title: 'Docker Container Patterns',
      content: 'This project demonstrates init containers and sidecar containers.',
      tags: ['docker', 'patterns'],
    },
  ];

  for (const note of seeds) {
    await client.query(
      'INSERT INTO notes (id, title, content, tags) VALUES ($1, $2, $3, $4)',
      [note.id, note.title, note.content, note.tags]
    );
    console.log(`[init-db-migrator] Seeded note: "${note.title}"`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('[init-db-migrator] Starting — init container for DB setup');
  try {
    await waitForDatabase();

    const client = new Client(DB_CONFIG);
    await client.connect();

    try {
      await runMigrations(client);
      await seedData(client);
    } finally {
      await client.end();
    }

    console.log('[init-db-migrator] Done — exiting with code 0');
    process.exit(0);
  } catch (err) {
    console.error('[init-db-migrator] Fatal error:', err.message);
    process.exit(1);
  }
}

main();

// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Database } from './database.js';
import * as schema from './schema.js';

export interface PostgresDatabase extends Database {
  readonly client: NodePgDatabase<typeof schema>;
}

export function isPostgresDatabase(
  database: Database
): database is PostgresDatabase {
  return 'client' in database;
}

export function createPostgresDatabase(databaseUrl: string): PostgresDatabase {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
  const client = drizzle({ client: pool, schema });

  return {
    client,
    async ping() {
      await client.execute(sql`select 1`);
    },
    async close() {
      await pool.end();
    }
  };
}

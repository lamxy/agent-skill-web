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
  // 閒置連線被伺服器單方面中斷（維運重啟、DROP DATABASE WITH (FORCE)、
  // pg_terminate_backend）時，pg 會在 pool 上發出 'error'。沒有這個 listener
  // 時 Node 會把它升級成 uncaughtException——正常查詢全部成功，行程卻仍以
  // 非零碼結束。pool 會自行汰換壞掉的連線，故此處只記錄不重連。
  pool.on('error', (error) => {
    process.emitWarning(
      `閒置資料庫連線被中斷：${error.message}`,
      { code: 'DB_IDLE_CONNECTION_TERMINATED' }
    );
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

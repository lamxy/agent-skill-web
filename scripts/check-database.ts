// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import 'dotenv/config';

import { loadConfig } from '../src/shared/config/config.js';
import { createPostgresDatabase } from '../src/shared/database/postgres-database.js';

const config = loadConfig();
const database = createPostgresDatabase(config.databaseUrl);

try {
  await database.ping();
  process.stdout.write('資料庫連線正常\n');
} finally {
  await database.close();
}

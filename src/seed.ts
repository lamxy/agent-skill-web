// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { seedDemoData } from './shared/database/demo-seeder.js';

/**
 * 容器內寫入示範資料的進入點：node dist/seed.js
 *
 * 與 src/migrate.ts 同樣的理由存在於 src/ 而非 scripts/：
 * runtime 映像已 prune 掉 tsx，只能執行編譯後的 .js。
 * 實作共用 shared/database/demo-seeder.ts，與 npm run db:seed 同一份資料。
 */

const nodeEnvironment = process.env.NODE_ENV ?? 'development';
if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test') {
  throw new Error(
    `示範資料只能寫入 development 或 test 環境，目前為 ${nodeEnvironment}`
  );
}

await seedDemoData();

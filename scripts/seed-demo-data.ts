// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

/**
 * 開發用示範資料。僅供本機預覽頁面效果，不在測試或生產使用。
 *
 * 執行：npm run db:seed
 * 資料庫使用 tmpfs，容器重啟後需要重新執行。
 *
 * 實作在 src/shared/database/demo-seeder.ts，與容器進入點 src/seed.ts 共用，
 * 避免同一份示範資料在兩處各維護一次。
 */
import { seedDemoData } from '../src/shared/database/demo-seeder.js';

await seedDemoData();

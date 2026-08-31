// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** 前端建置產物目錄，相對於編譯後的 dist/shared/web/ 位置 */
function resolveWebRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
}

/**
 * 掛載前端靜態檔案。前端與 API 同源，session 由 HttpOnly Cookie 承載，
 * 因此不需要 CORS 設定。
 *
 * 必須在所有 API 模組註冊之後呼叫：SPA fallback 會接管未匹配的 GET 請求，
 * 先掛載會讓 API 路由被吃掉。
 */
export async function registerStaticSite(app: FastifyInstance): Promise<void> {
  const root = resolveWebRoot();

  // 開發模式由 Vite dev server 提供前端，此時 dist/web 尚不存在，直接略過。
  // 用 warn 而非 info：略過之後本連接埠只有 API，所有頁面路由都會回 404。
  // 這是預期行為，但沒有這行訊息就只能看到一連串莫名的 404。
  if (!existsSync(root)) {
    app.log.warn(
      '前端建置產物不存在，略過靜態託管。本連接埠只提供 API，' +
        '頁面請改用 npm run dev:web（預設 :5173），' +
        '或先執行 npm run build:web 後重啟。'
    );
    return;
  }

  await app.register(fastifyStatic, { root, wildcard: false });

  // SPA 由前端路由接管，任何未匹配的頁面請求都回傳 index.html。
  // 僅限 GET 與 HEAD，且排除 API 與文件路徑，避免掩蓋後端的 404 與 405。
  app.setNotFoundHandler((request, reply) => {
    const isPageRequest =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/docs') &&
      !request.url.startsWith('/health');

    if (isPageRequest) {
      return reply.sendFile('index.html');
    }

    return reply.status(404).send({
      code: 'NOT_FOUND',
      message: '找不到請求的資源'
    });
  });
}

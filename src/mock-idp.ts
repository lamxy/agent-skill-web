// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createMockIdpServer } from './modules/identity/mock-idp-server.js';

/**
 * 模擬 IdP 的容器進入點（compose.stack.yaml 使用）。
 *
 * 與 scripts/start-mock-idp.ts 同樣的行為，差別只在這支位於 src/，
 * 會被 tsconfig.build.json 編譯進 dist/，因此能在已 prune 掉 tsx 的
 * runtime 映像中執行。宿主機開發請繼續用 npm run dev:idp。
 *
 * 沿用同一道防線：非 development/test 一律拒絕啟動，
 * 避免模擬 IdP 被誤帶到正式環境（見 .env.example 注意事項 3）。
 */

const nodeEnvironment = process.env.NODE_ENV ?? 'development';
if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test') {
  throw new Error(
    `模擬 IdP 只能在 development 或 test 執行，目前為 ${nodeEnvironment}`
  );
}

const port = Number(process.env.MOCK_IDP_PORT ?? 4780);
// 容器內必須綁 0.0.0.0，否則同一 compose 網路的其他服務連不進來。
const host = process.env.MOCK_IDP_HOST ?? '0.0.0.0';

const app = createMockIdpServer({
  ...(process.env.OIDC_CLIENT_ID ? { clientId: process.env.OIDC_CLIENT_ID } : {}),
  ...(process.env.OIDC_CLIENT_SECRET
    ? { clientSecret: process.env.OIDC_CLIENT_SECRET }
    : {}),
  claims: {
    uid: process.env.OIDC_CLAIM_UID ?? 'sub',
    displayName: process.env.OIDC_CLAIM_DISPLAY_NAME ?? 'name',
    teams: process.env.OIDC_CLAIM_TEAMS ?? 'groups'
  }
});

await app.listen({ port, host });

process.stdout.write(`模擬 IdP 已啟動於 http://${host}:${port}\n`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

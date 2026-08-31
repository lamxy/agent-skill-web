// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createMockIdpServer } from '../src/modules/identity/mock-idp-server.js';

/**
 * 啟動開發期的模擬 OAuth2 IdP。
 *
 * 用法：npm run dev:idp
 * 接著在 .env 設定 OIDC_* 指向本服務，見 .env.example。
 */

const nodeEnvironment = process.env.NODE_ENV ?? 'development';
if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test') {
  throw new Error(
    `模擬 IdP 只能在 development 或 test 執行，目前為 ${nodeEnvironment}`
  );
}

const port = Number(process.env.MOCK_IDP_PORT ?? 4780);
const host = process.env.MOCK_IDP_HOST ?? '127.0.0.1';

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

process.stdout.write(
  `模擬 IdP 已啟動於 http://${host}:${port}\n` +
    `  authorize: http://${host}:${port}/authorize\n` +
    `  token:     http://${host}:${port}/token\n` +
    `  userinfo:  http://${host}:${port}/userinfo\n`
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomBytes } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

/**
 * 開發期用的最小 OAuth2 身份提供者。
 *
 * 存在的理由：企業 IdP 的授權 URL 尚未開放，而 DevelopmentIdentityProvider
 * 走的是捷徑（直接把 uid 當 code），完全繞過 authorize 轉導、code 交換與
 * userinfo 請求，驗證不了 OAuth2IdentityProvider 真正要跑的路徑。
 *
 * 本伺服器只實作協議的必要形狀，讓開發期跑的是與正式環境相同的鏈路；
 * 真實憑證到位後只需改環境變數指向公司 IdP，程式碼不動。
 *
 * 僅供 development 與 test 使用。config.ts 會拒絕正式環境的 OIDC 端點
 * 指向本機位址。
 */

export interface MockIdentity {
  uid: string;
  displayName: string;
  teams: string[];
}

export const defaultMockIdentities: MockIdentity[] = [
  { uid: 'mock-admin', displayName: '模擬管理員', teams: ['platform'] },
  { uid: 'mock-reviewer', displayName: '模擬審核人', teams: ['quality'] },
  { uid: 'mock-user', displayName: '模擬使用者', teams: ['development'] }
];

export interface MockIdpOptions {
  identities?: MockIdentity[];
  clientId?: string;
  clientSecret?: string;
  /** 對應 OIDC_CLAIM_* 的 claim 名稱，用於驗證欄位映射可配置性。 */
  claims?: { uid: string; displayName: string; teams: string };
}

interface IssuedCode {
  uid: string;
  expiresAt: number;
}

const CODE_TTL_MS = 5 * 60 * 1000;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character] ?? character
  );
}

export function createMockIdpServer(
  options: MockIdpOptions = {}
): FastifyInstance {
  const identities = new Map(
    (options.identities ?? defaultMockIdentities).map((identity) => [
      identity.uid,
      identity
    ])
  );
  const clientId = options.clientId ?? 'local-dev';
  const clientSecret = options.clientSecret ?? 'local-dev-secret';
  const claims = options.claims ?? {
    uid: 'sub',
    displayName: 'name',
    teams: 'groups'
  };

  const issuedCodes = new Map<string, IssuedCode>();
  const issuedTokens = new Map<string, string>();

  const app = Fastify({ logger: false });

  // OAuth2 的 token 端點以表單編碼送出，Fastify 預設不解析此格式。
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, body);
    }
  );

  // 授權頁：列出可選身份，點選後帶 code 與原樣 state 轉回平台。
  app.get('/authorize', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const redirectUri = query.redirect_uri;
    const state = query.state ?? '';

    if (query.client_id !== clientId) {
      return reply.status(400).send({ error: 'invalid_client' });
    }
    if (!redirectUri) {
      return reply.status(400).send({ error: 'invalid_request' });
    }

    // 帶 uid 參數時直接發碼，供自動化測試略過選人步驟。
    if (query.uid) {
      if (!identities.has(query.uid)) {
        return reply.status(400).send({ error: 'unknown_user' });
      }
      const code = issueCode(query.uid);
      return reply.redirect(buildCallbackUrl(redirectUri, code, state));
    }

    const rows = [...identities.values()]
      .map((identity) => {
        const href = buildAuthorizeUrl(request.url, identity.uid);
        return `<li><a href="${escapeHtml(href)}">
          <strong>${escapeHtml(identity.displayName)}</strong>
          <code>${escapeHtml(identity.uid)}</code>
          <span>${escapeHtml(identity.teams.join('、') || '無團隊')}</span>
        </a></li>`;
      })
      .join('');

    return reply.type('text/html; charset=utf-8').send(
      `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>模擬企業登入</title><style>
body{font:14px/1.5 system-ui,"PingFang TC","Noto Sans TC",sans-serif;background:#f6f7f9;color:#16181d;margin:0;padding:48px 16px}
.box{max-width:420px;margin:0 auto;background:#fff;border:1px solid #dfe2e8;border-radius:11px;padding:22px}
h1{font-size:17px;margin:0 0 4px}p{color:#5b616e;margin:0 0 16px;font-size:13px}
ul{list-style:none;margin:0;padding:0}li{margin-bottom:8px}
a{display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid #dfe2e8;border-radius:8px;text-decoration:none;color:inherit}
a:hover{border-color:#1f4fd8;background:#eef2fe}
code{font-size:11.5px;color:#8b91a0}span{margin-left:auto;font-size:11.5px;color:#5b616e}
.warn{margin-top:16px;font-size:11.5px;color:#8a5a00;background:#fdf3e0;padding:8px 11px;border-radius:6px}
</style></head><body><div class="box">
<h1>模擬企業登入</h1><p>開發期替身，選擇一個身份繼續。</p>
<ul>${rows}</ul>
<div class="warn">此為本機模擬 IdP，不得用於正式環境。</div>
</div></body></html>`
    );
  });

  // code 換 token。驗證 client 憑證與 code 有效性。
  app.post('/token', async (request, reply) => {
    const body = parseFormBody(request.body);

    if (body.client_id !== clientId || body.client_secret !== clientSecret) {
      return reply.status(401).send({ error: 'invalid_client' });
    }
    if (body.grant_type !== 'authorization_code') {
      return reply.status(400).send({ error: 'unsupported_grant_type' });
    }

    const code = body.code ?? '';
    const issued = issuedCodes.get(code);
    // code 為一次性，換取後立即失效。
    issuedCodes.delete(code);

    if (!issued || issued.expiresAt < Date.now()) {
      return reply.status(400).send({ error: 'invalid_grant' });
    }

    const accessToken = randomBytes(24).toString('base64url');
    issuedTokens.set(accessToken, issued.uid);
    return reply.send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600
    });
  });

  // 以 claim 名稱回傳身份，驗證平台的欄位映射確實可配置。
  app.get('/userinfo', async (request, reply) => {
    const authorization = request.headers.authorization ?? '';
    const token = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : '';
    const uid = issuedTokens.get(token);
    const identity = uid ? identities.get(uid) : undefined;

    if (!identity) {
      return reply.status(401).send({ error: 'invalid_token' });
    }

    return reply.send({
      [claims.uid]: identity.uid,
      [claims.displayName]: identity.displayName,
      [claims.teams]: identity.teams
    });
  });

  function issueCode(uid: string): string {
    const code = randomBytes(18).toString('base64url');
    issuedCodes.set(code, { uid, expiresAt: Date.now() + CODE_TTL_MS });
    return code;
  }

  function buildAuthorizeUrl(currentUrl: string, uid: string): string {
    const url = new URL(currentUrl, 'http://placeholder');
    url.searchParams.set('uid', uid);
    return `${url.pathname}?${url.searchParams.toString()}`;
  }

  function buildCallbackUrl(
    redirectUri: string,
    code: string,
    state: string
  ): string {
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) {
      url.searchParams.set('state', state);
    }
    return url.toString();
  }

  return app;
}

function parseFormBody(body: unknown): Record<string, string> {
  if (typeof body === 'string') {
    return Object.fromEntries(new URLSearchParams(body));
  }
  if (body && typeof body === 'object') {
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value)
      ])
    );
  }
  return {};
}

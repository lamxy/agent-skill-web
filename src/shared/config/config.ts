// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { z } from 'zod';

const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:5432/agent_skill_platform';

const environmentSchema = z.enum([
  'development',
  'test',
  'staging',
  'production'
]);

const logLevelSchema = z.enum([
  'silent',
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace'
]);

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), {
    message: 'OIDC URL 必須是 http 或 https'
  });

/**
 * 正式環境的 OIDC 端點必須是外部可達的 https。開發期的 mock IdP 走
 * http://127.0.0.1，若誤帶進 production 會讓登入指向本機的假身份來源，
 * 因此在此明確擋下，而不是等執行期才失敗。
 */
const LOCAL_HOST_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)[:/]?/i;

export interface OidcConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  /** userinfo 回應中對應各欄位的 claim 名稱。不同 IdP 命名不一，故可配置。 */
  claims: {
    uid: string;
    displayName: string;
    teams: string;
  };
}

export interface AppConfig {
  environment: z.infer<typeof environmentSchema>;
  host: string;
  port: number;
  logLevel: z.infer<typeof logLevelSchema>;
  databaseUrl: string;
  telemetryEndpoint?: string;
  oidc?: OidcConfig;
  notification?: NotificationConfig;
  /**
   * 首位平台管理員的 uid。授予角色本身需要 platform_admin，
   * 正式環境因此需要一條 bootstrap 路徑，否則無人能授權他人。
   * 該 uid 首次登入且尚無 platform_admin 時自動授予，之後不再觸發。
   */
  bootstrapAdminUid?: string;
  /**
   * 允許登入的 uid 白名單。未設定時不限制，任何通過 IdP 驗證的人都能登入。
   *
   * 公網部署且 IdP 對全網開放（例如 GitHub OAuth）時應設定：
   * 沒有角色雖然本來就沒有權限，但仍會在 identities 留下記錄，
   * 白名單讓非預期對象在建立記錄前就被擋下。
   */
  loginAllowedUids?: readonly string[];
}

const OIDC_REQUIRED_KEYS = [
  'OIDC_AUTHORIZE_URL',
  'OIDC_TOKEN_URL',
  'OIDC_USERINFO_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI'
] as const;

function loadOidcConfig(
  environment: NodeJS.ProcessEnv,
  runtimeEnvironment: z.infer<typeof environmentSchema>
): OidcConfig | undefined {
  const present = OIDC_REQUIRED_KEYS.filter((key) =>
    Boolean(environment[key]?.trim())
  );

  if (present.length === 0) {
    return undefined;
  }

  // 部分配置比完全沒有配置更危險：會在登入途中才失敗。要求全有或全無。
  if (present.length !== OIDC_REQUIRED_KEYS.length) {
    const missing = OIDC_REQUIRED_KEYS.filter((key) => !present.includes(key));
    throw new Error(`OIDC 配置不完整，缺少：${missing.join('、')}`);
  }

  const urls = {
    authorizeUrl: httpsUrlSchema.parse(environment.OIDC_AUTHORIZE_URL?.trim()),
    tokenUrl: httpsUrlSchema.parse(environment.OIDC_TOKEN_URL?.trim()),
    userInfoUrl: httpsUrlSchema.parse(environment.OIDC_USERINFO_URL?.trim()),
    redirectUri: httpsUrlSchema.parse(environment.OIDC_REDIRECT_URI?.trim())
  };

  if (runtimeEnvironment === 'production' || runtimeEnvironment === 'staging') {
    const localEndpoint = (
      [
        ['OIDC_AUTHORIZE_URL', urls.authorizeUrl],
        ['OIDC_TOKEN_URL', urls.tokenUrl],
        ['OIDC_USERINFO_URL', urls.userInfoUrl]
      ] as const
    ).find(([, value]) => LOCAL_HOST_PATTERN.test(value));

    if (localEndpoint) {
      throw new Error(
        `正式或 staging 環境的 ${localEndpoint[0]} 不得指向本機位址`
      );
    }
  }

  return {
    ...urls,
    clientId: environment.OIDC_CLIENT_ID!.trim(),
    clientSecret: environment.OIDC_CLIENT_SECRET!.trim(),
    scope: environment.OIDC_SCOPE?.trim() || 'openid profile',
    claims: {
      uid: environment.OIDC_CLAIM_UID?.trim() || 'sub',
      displayName: environment.OIDC_CLAIM_DISPLAY_NAME?.trim() || 'name',
      teams: environment.OIDC_CLAIM_TEAMS?.trim() || 'groups'
    }
  };
}

export interface NotificationConfig {
  /** 已配置 webhook 的渠道。未配置者不啟用，站內通知不受影響。 */
  slackWebhookUrl?: string;
  teamsWebhookUrl?: string;
  larkWebhookUrl?: string;
  /** 訊息內連結需絕對位址，webhook 收件端不在平台網域內 */
  baseUrl?: string;
}

function loadNotificationConfig(
  environment: NodeJS.ProcessEnv
): NotificationConfig | undefined {
  const entries = {
    slackWebhookUrl: environment.NOTIFY_SLACK_WEBHOOK_URL?.trim(),
    teamsWebhookUrl: environment.NOTIFY_TEAMS_WEBHOOK_URL?.trim(),
    larkWebhookUrl: environment.NOTIFY_LARK_WEBHOOK_URL?.trim()
  };
  const configured = Object.entries(entries).filter(([, value]) => Boolean(value));

  if (configured.length === 0) {
    return undefined;
  }

  for (const [key, value] of configured) {
    // 錯字的 webhook 會讓通知靜默消失，寧可啟動即失敗。
    if (!/^https:\/\//.test(value!)) {
      throw new Error(`通知渠道 ${key} 必須是 https 位址`);
    }
  }

  return {
    ...Object.fromEntries(configured),
    ...(environment.PLATFORM_BASE_URL?.trim()
      ? { baseUrl: environment.PLATFORM_BASE_URL.trim() }
      : {})
  };
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): AppConfig {
  const runtimeEnvironment = environmentSchema.parse(
    environment.NODE_ENV ?? 'development'
  );
  const port = Number(environment.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be between 1 and 65535');
  }

  const databaseUrl = environment.DATABASE_URL?.trim();
  if (runtimeEnvironment !== 'development' && !databaseUrl) {
    throw new Error('DATABASE_URL is required outside development');
  }

  const oidc = loadOidcConfig(environment, runtimeEnvironment);
  const notification = loadNotificationConfig(environment);
  const bootstrapAdminUid = environment.BOOTSTRAP_ADMIN_UID?.trim();

  // 逗號分隔；空白項目略過。全為空白視為未設定，維持不限制。
  const loginAllowedUids = environment.LOGIN_ALLOWED_UIDS?.split(',')
    .map((uid) => uid.trim())
    .filter((uid) => uid.length > 0);

  // 白名單漏掉管理員會導致無人能登入，且症狀是「登入被拒」而非設定錯誤，
  // 難以聯想到原因。啟動時直接擋下，不等到上線後才發現。
  if (
    loginAllowedUids &&
    loginAllowedUids.length > 0 &&
    bootstrapAdminUid &&
    !loginAllowedUids.includes(bootstrapAdminUid)
  ) {
    throw new Error(
      'LOGIN_ALLOWED_UIDS 未包含 BOOTSTRAP_ADMIN_UID，將導致管理員無法登入'
    );
  }

  return {
    environment: runtimeEnvironment,
    host: environment.HOST?.trim() || '127.0.0.1',
    port,
    logLevel: logLevelSchema.parse(
      environment.LOG_LEVEL ??
        (runtimeEnvironment === 'development' ? 'debug' : 'info')
    ),
    databaseUrl: databaseUrl || DEFAULT_DATABASE_URL,
    ...(environment.TELEMETRY_ENDPOINT?.trim()
      ? { telemetryEndpoint: environment.TELEMETRY_ENDPOINT.trim() }
      : {}),
    ...(oidc ? { oidc } : {}),
    ...(notification ? { notification } : {}),
    ...(bootstrapAdminUid ? { bootstrapAdminUid } : {}),
    ...(loginAllowedUids && loginAllowedUids.length > 0
      ? { loginAllowedUids }
      : {})
  };
}

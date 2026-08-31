// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createHash, randomBytes } from 'node:crypto';

import type { ProviderIdentity } from './types.js';
import type { OidcConfig } from '../../shared/config/config.js';
import { AppError } from '../../shared/errors/app-error.js';

interface BeginLoginInput {
  uid?: string;
  returnTo: string;
}

interface CompleteLoginInput {
  code: string;
  state?: string;
}

export interface IdentityProvider {
  readonly kind: 'development' | 'oidc' | 'disabled';
  beginLogin(input: BeginLoginInput): Promise<{ redirectUrl: string }>;
  completeLogin(input: CompleteLoginInput): Promise<ProviderIdentity>;
}

export const defaultDevelopmentIdentities: ProviderIdentity[] = [
  {
    uid: 'dev-admin',
    displayName: '開發管理員',
    teamIds: ['platform']
  },
  {
    uid: 'dev-user',
    displayName: '開發使用者',
    teamIds: ['development']
  }
];

export class DevelopmentIdentityProvider implements IdentityProvider {
  readonly kind = 'development' as const;
  private readonly identities = new Map<string, ProviderIdentity>();

  constructor(identities: ProviderIdentity[] = defaultDevelopmentIdentities) {
    for (const identity of identities) {
      this.identities.set(identity.uid, {
        ...identity,
        teamIds: [...identity.teamIds]
      });
    }
  }

  async beginLogin(
    input: BeginLoginInput
  ): Promise<{ redirectUrl: string }> {
    const uid = input.uid ?? this.identities.keys().next().value;
    if (!uid || !this.identities.has(uid)) {
      throw new AppError({
        statusCode: 401,
        code: 'DEVELOPMENT_IDENTITY_UNKNOWN',
        message: '找不到指定的開發身份'
      });
    }
    const query = new URLSearchParams({ code: uid, returnTo: input.returnTo });
    return { redirectUrl: `/api/auth/callback?${query.toString()}` };
  }

  async completeLogin(input: CompleteLoginInput): Promise<ProviderIdentity> {
    const identity = this.identities.get(input.code);
    if (!identity) {
      throw new AppError({
        statusCode: 401,
        code: 'AUTHENTICATION_FAILED',
        message: '身份驗證失敗'
      });
    }
    return { ...identity, teamIds: [...identity.teamIds] };
  }
}

interface OAuth2IdentityProviderOptions {
  config: OidcConfig;
  /** 注入點：測試以此替換 HTTP 層，正式執行時使用全域 fetch。 */
  fetchImpl?: typeof fetch;
  stateFactory?: () => string;
  clock?: () => Date;
}

interface PendingState {
  returnTo: string;
  createdAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

function readClaim(source: Record<string, unknown>, path: string): unknown {
  // 支援 "a.b" 形式的巢狀 claim，IdP 常把團隊放在巢狀物件中。
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      source
    );
}

function normaliseTeams(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  // 部分 IdP 以逗號或空白分隔的字串回傳群組。
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

export class OAuth2IdentityProvider implements IdentityProvider {
  readonly kind = 'oidc' as const;
  private readonly config: OidcConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly stateFactory: () => string;
  private readonly clock: () => Date;
  private readonly pendingStates = new Map<string, PendingState>();

  constructor(options: OAuth2IdentityProviderOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.stateFactory =
      options.stateFactory ?? (() => randomBytes(24).toString('base64url'));
    this.clock = options.clock ?? (() => new Date());
  }

  async beginLogin(input: BeginLoginInput): Promise<{ redirectUrl: string }> {
    this.pruneExpiredStates();
    const state = this.stateFactory();
    this.pendingStates.set(this.digestState(state), {
      returnTo: input.returnTo,
      createdAt: this.clock().getTime()
    });

    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state
    });
    return {
      redirectUrl: `${this.config.authorizeUrl}?${query.toString()}`
    };
  }

  async completeLogin(input: CompleteLoginInput): Promise<ProviderIdentity> {
    this.consumeState(input.state);
    const accessToken = await this.exchangeCode(input.code);
    return this.fetchIdentity(accessToken);
  }

  /**
   * 回傳 beginLogin 當時登記的 returnTo。state 已在 completeLogin 消耗，
   * 故此方法必須在 completeLogin 之前呼叫。
   */
  peekReturnTo(state: string | undefined): string | undefined {
    if (!state) {
      return undefined;
    }
    return this.pendingStates.get(this.digestState(state))?.returnTo;
  }

  private async exchangeCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });

    const response = await this.request(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body: body.toString()
    });

    if (!response.ok) {
      throw this.authenticationFailed();
    }

    const payload = (await response.json()) as { access_token?: unknown };
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      throw this.authenticationFailed();
    }
    return payload.access_token;
  }

  private async fetchIdentity(accessToken: string): Promise<ProviderIdentity> {
    const response = await this.request(this.config.userInfoUrl, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw this.authenticationFailed();
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const uid = readClaim(payload, this.config.claims.uid);
    if (typeof uid !== 'string' || !uid.trim()) {
      throw new AppError({
        statusCode: 502,
        code: 'IDENTITY_CLAIM_MISSING',
        message: '身份提供者未回傳可用的使用者識別'
      });
    }

    const displayName = readClaim(payload, this.config.claims.displayName);
    return {
      uid: uid.trim(),
      displayName:
        typeof displayName === 'string' && displayName.trim()
          ? displayName.trim()
          : uid.trim(),
      teamIds: normaliseTeams(readClaim(payload, this.config.claims.teams))
    };
  }

  private async request(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    // IdP 無回應時不能讓登入請求無限期掛住。
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      throw new AppError({
        statusCode: 502,
        code: 'IDENTITY_PROVIDER_UNREACHABLE',
        message: '無法連線至身份提供者'
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** state 為一次性：驗證後立即移除，避免 callback 被重放。 */
  private consumeState(state: string | undefined): void {
    this.pruneExpiredStates();
    if (!state) {
      throw this.stateRejected();
    }
    const digest = this.digestState(state);
    const pending = this.pendingStates.get(digest);
    if (!pending) {
      throw this.stateRejected();
    }
    this.pendingStates.delete(digest);
  }

  private digestState(state: string): string {
    return createHash('sha256').update(state).digest('hex');
  }

  private pruneExpiredStates(): void {
    const threshold = this.clock().getTime() - STATE_TTL_MS;
    for (const [digest, pending] of this.pendingStates) {
      if (pending.createdAt < threshold) {
        this.pendingStates.delete(digest);
      }
    }
  }

  private stateRejected(): AppError {
    return new AppError({
      statusCode: 400,
      code: 'AUTHENTICATION_STATE_INVALID',
      message: '登入請求已逾時或無效，請重新登入'
    });
  }

  private authenticationFailed(): AppError {
    return new AppError({
      statusCode: 401,
      code: 'AUTHENTICATION_FAILED',
      message: '身份驗證失敗'
    });
  }
}

export class DisabledIdentityProvider implements IdentityProvider {
  readonly kind = 'disabled' as const;

  async beginLogin(): Promise<never> {
    throw this.unavailable();
  }

  async completeLogin(): Promise<never> {
    throw this.unavailable();
  }

  private unavailable(): AppError {
    return new AppError({
      statusCode: 503,
      code: 'AUTH_PROVIDER_UNAVAILABLE',
      message: '正式身份提供者尚未配置'
    });
  }
}

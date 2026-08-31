// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { AuthorizationService } from './authorization-service.js';
import {
  parseCookieHeader,
  serializeIdentityCookie
} from './cookie.js';
import {
  DevelopmentIdentityProvider,
  DisabledIdentityProvider,
  OAuth2IdentityProvider,
  type IdentityProvider
} from './identity-provider.js';
import type { IdentityRepository } from './repository.js';
import { SessionService } from './session-service.js';
import type { ResolvedIdentity, Role, RoleScopeType } from './types.js';
import type { AppConfig } from '../../shared/config/config.js';
import { AppError } from '../../shared/errors/app-error.js';

const SESSION_COOKIE = 'asp_session';
const ANONYMOUS_COOKIE = 'asp_anonymous';
const ANONYMOUS_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface IdentityModuleOptions {
  config: AppConfig;
  repository: IdentityRepository;
  provider?: IdentityProvider;
  clock?: () => Date;
  sessionTokenFactory?: () => string;
  anonymousIdFactory?: () => string;
}

function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
    ? value
    : '/';
}

function cookiesFrom(request: FastifyRequest): Record<string, string> {
  return parseCookieHeader(request.headers.cookie);
}

function requireAuthenticated(identity: ResolvedIdentity): string {
  if (identity.kind !== 'authenticated') {
    throw new AppError({
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
      message: '請先登入'
    });
  }
  return identity.uid;
}

/**
 * OIDC 配置齊全時一律優先，開發環境亦然——這正是 mock IdP 的接入方式，
 * 讓開發期跑的是與正式環境相同的協議路徑。未配置時才退回開發身份，
 * 非開發環境則 fail-closed。
 */
function selectProvider(config: AppConfig): IdentityProvider {
  if (config.oidc) {
    return new OAuth2IdentityProvider({ config: config.oidc });
  }
  return config.environment === 'development' || config.environment === 'test'
    ? new DevelopmentIdentityProvider()
    : new DisabledIdentityProvider();
}

export function createIdentityModule(
  options: IdentityModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(
    async (app) => {
      const provider = options.provider ?? selectProvider(options.config);
      if (
        (options.config.environment === 'production' ||
          options.config.environment === 'staging') &&
        provider.kind === 'development'
      ) {
        throw new Error('正式或 staging 環境不得啟用開發身份提供者');
      }

      const clock = options.clock ?? (() => new Date());
      const sessions = new SessionService({
        repository: options.repository,
        clock,
        ...(options.sessionTokenFactory
          ? { sessionTokenFactory: options.sessionTokenFactory }
          : {}),
        ...(options.anonymousIdFactory
          ? { anonymousIdFactory: options.anonymousIdFactory }
          : {})
      });
      const authorization = new AuthorizationService(
        options.repository,
        clock
      );
      const secureCookie = options.config.environment === 'production';

      async function resolveRequestIdentity(
        request: FastifyRequest
      ): Promise<ResolvedIdentity> {
        const cookies = cookiesFrom(request);
        return sessions.resolve({
          ...(cookies[SESSION_COOKIE]
            ? { sessionToken: cookies[SESSION_COOKIE] }
            : {}),
          ...(cookies[ANONYMOUS_COOKIE]
            ? { anonymousId: cookies[ANONYMOUS_COOKIE] }
            : {})
        });
      }

      app.get(
        '/api/auth/login',
        {
          schema: {
            tags: ['identity'],
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                uid: { type: 'string', minLength: 1, maxLength: 200 },
                returnTo: { type: 'string', maxLength: 500 }
              }
            }
          }
        },
        async (request, reply) => {
          const query = request.query as { uid?: string; returnTo?: string };
          const result = await provider.beginLogin({
            ...(query.uid ? { uid: query.uid } : {}),
            returnTo: safeReturnTo(query.returnTo)
          });
          return reply.redirect(result.redirectUrl);
        }
      );

      app.get(
        '/api/auth/callback',
        {
          schema: {
            tags: ['identity'],
            querystring: {
              type: 'object',
              required: ['code'],
              additionalProperties: false,
              properties: {
                code: { type: 'string', minLength: 1, maxLength: 1000 },
                state: { type: 'string', maxLength: 500 },
                returnTo: { type: 'string', maxLength: 500 }
              }
            }
          }
        },
        async (request, reply) => {
          const query = request.query as {
            code: string;
            state?: string;
            returnTo?: string;
          };
          // IdP 不會回傳我們的 returnTo，只回傳 state；改由 state 取回原始目的地。
          const registeredReturnTo =
            provider instanceof OAuth2IdentityProvider
              ? provider.peekReturnTo(query.state)
              : undefined;
          const externalIdentity = await provider.completeLogin({
            code: query.code,
            ...(query.state ? { state: query.state } : {})
          });
          // 白名單在 upsertIdentity 之前檢查：未獲准者不應留下 identity 記錄。
          const allowedUids = options.config.loginAllowedUids;
          if (allowedUids && !allowedUids.includes(externalIdentity.uid)) {
            app.log.warn(
              { uid: externalIdentity.uid },
              '登入遭白名單拒絕（LOGIN_ALLOWED_UIDS）'
            );
            return reply.code(403).send({
              error: 'forbidden',
              message: '此帳號未獲准存取本平台'
            });
          }
          const currentTime = clock();
          await options.repository.upsertIdentity({
            ...externalIdentity,
            providerType: provider.kind === 'oidc' ? 'oidc' : 'development',
            active: true,
            createdAt: currentTime,
            updatedAt: currentTime
          });
          if (
            provider.kind === 'development' &&
            externalIdentity.uid === 'dev-admin'
          ) {
            await authorization.grantDevelopmentAdmin(externalIdentity.uid);
          } else if (
            options.config.bootstrapAdminUid &&
            externalIdentity.uid === options.config.bootstrapAdminUid
          ) {
            // 正式環境的首位管理員：僅在該 uid 尚無 platform_admin 時授予。
            const granted = await authorization.grantBootstrapAdmin(
              externalIdentity.uid
            );
            if (granted) {
              // 提權屬高風險事件，必須留痕；uid 以外不記其他身份欄位。
              app.log.warn(
                { uid: externalIdentity.uid },
                '依 BOOTSTRAP_ADMIN_UID 授予首位平台管理員'
              );
            }
          }
          const session = await sessions.create(externalIdentity.uid);
          const maxAgeSeconds = Math.max(
            0,
            Math.floor(
              (session.expiresAt.getTime() - currentTime.getTime()) / 1000
            )
          );
          reply.header(
            'set-cookie',
            serializeIdentityCookie(SESSION_COOKIE, session.token, {
              maxAgeSeconds,
              secure: secureCookie
            })
          );
          return reply.redirect(
            safeReturnTo(registeredReturnTo ?? query.returnTo)
          );
        }
      );

      app.get(
        '/api/auth/me',
        { schema: { tags: ['identity'] } },
        async (request, reply) => {
          const identity = await resolveRequestIdentity(request);
          if (identity.kind === 'anonymous') {
            if (identity.isNew) {
              reply.header(
                'set-cookie',
                serializeIdentityCookie(
                  ANONYMOUS_COOKIE,
                  identity.anonymousId,
                  {
                    maxAgeSeconds: ANONYMOUS_COOKIE_MAX_AGE_SECONDS,
                    secure: secureCookie
                  }
                )
              );
            }
            return {
              kind: 'anonymous' as const,
              anonymousId: identity.anonymousId
            };
          }

          const roles = await options.repository.listActiveRoles(identity.uid);
          return {
            ...identity,
            roles: roles.map(({ role, scopeType, scopeValue }) => ({
              role,
              scopeType,
              scopeValue
            }))
          };
        }
      );

      app.get(
        '/api/admin/reviewers',
        { schema: { tags: ['identity-admin'] } },
        async (request) => {
          const actorUid = requireAuthenticated(
            await resolveRequestIdentity(request)
          );
          return {
            items: await authorization.listReviewerAssignments(actorUid)
          };
        }
      );

      app.get(
        '/api/admin/reviewer-candidates',
        { schema: { tags: ['identity-admin'] } },
        async (request) => {
          const actorUid = requireAuthenticated(
            await resolveRequestIdentity(request)
          );
          const identities = await authorization.listReviewerCandidates(actorUid);
          return {
            items: identities.map(({ uid, displayName, teamIds }) => ({
              uid,
              displayName,
              teamIds
            }))
          };
        }
      );

      app.get(
        '/api/admin/roles',
        {
          schema: {
            tags: ['identity-admin'],
            querystring: {
              type: 'object',
              required: ['uid'],
              additionalProperties: false,
              properties: {
                uid: { type: 'string', minLength: 1, maxLength: 200 }
              }
            }
          }
        },
        async (request) => {
          const actorUid = requireAuthenticated(
            await resolveRequestIdentity(request)
          );
          const { uid } = request.query as { uid: string };
          return {
            items: await authorization.listRoleAssignments(actorUid, uid)
          };
        }
      );

      app.post(
        '/api/admin/roles',
        {
          schema: {
            tags: ['identity-admin'],
            body: {
              type: 'object',
              required: ['uid', 'role', 'scopeType'],
              additionalProperties: false,
              properties: {
                uid: { type: 'string', minLength: 1, maxLength: 200 },
                // 不含 platform_admin：該角色只能由 BOOTSTRAP_ADMIN_UID 產生。
                role: {
                  type: 'string',
                  enum: ['employee', 'maintainer', 'reviewer']
                },
                scopeType: {
                  type: 'string',
                  enum: ['global', 'team', 'package_type', 'category', 'package']
                },
                scopeValue: { type: 'string', maxLength: 200 }
              }
            }
          }
        },
        async (request, reply) => {
          const actorUid = requireAuthenticated(
            await resolveRequestIdentity(request)
          );
          const input = request.body as {
            uid: string;
            role: Role;
            scopeType: RoleScopeType;
            scopeValue?: string;
          };
          const assignment = await authorization.grantRole(actorUid, input);
          return reply.status(201).send(assignment);
        }
      );

      app.delete(
        '/api/admin/roles',
        {
          schema: {
            tags: ['identity-admin'],
            body: {
              type: 'object',
              required: ['uid', 'role'],
              additionalProperties: false,
              properties: {
                uid: { type: 'string', minLength: 1, maxLength: 200 },
                role: {
                  type: 'string',
                  enum: ['employee', 'maintainer', 'reviewer']
                }
              }
            }
          }
        },
        async (request) => {
          const actorUid = requireAuthenticated(
            await resolveRequestIdentity(request)
          );
          const input = request.body as { uid: string; role: Role };
          const revoked = await authorization.revokeRoleAssignment(
            actorUid,
            input
          );
          return { revoked };
        }
      );

      app.post(
        '/api/auth/logout',
        { schema: { tags: ['identity'] } },
        async (request, reply) => {
          const sessionToken = cookiesFrom(request)[SESSION_COOKIE];
          if (sessionToken) {
            await sessions.logout(sessionToken);
          }
          reply.header(
            'set-cookie',
            serializeIdentityCookie(SESSION_COOKIE, '', {
              maxAgeSeconds: 0,
              secure: secureCookie
            })
          );
          return { loggedOut: true };
        }
      );

      app.post(
        '/api/admin/reviewers',
        {
          schema: {
            tags: ['identity-admin'],
            body: {
              type: 'object',
              required: ['reviewerUid', 'packageType', 'category'],
              additionalProperties: false,
              properties: {
                reviewerUid: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 200
                },
                packageType: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 100
                },
                category: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 100
                }
              }
            }
          }
        },
        async (request, reply) => {
          const actorUid = requireAuthenticated(
            await resolveRequestIdentity(request)
          );
          const input = request.body as {
            reviewerUid: string;
            packageType: string;
            category: string;
          };
          const assignment = await authorization.assignReviewer(
            actorUid,
            input
          );
          return reply.status(201).send(assignment);
        }
      );

      app.delete(
        '/api/admin/reviewers/:id',
        {
          schema: {
            tags: ['identity-admin'],
            params: {
              type: 'object',
              required: ['id'],
              additionalProperties: false,
              properties: { id: { type: 'string', format: 'uuid' } }
            }
          }
        },
        async (request) => {
          const actorUid = requireAuthenticated(
            await resolveRequestIdentity(request)
          );
          const { id } = request.params as { id: string };
          const assignment = await authorization.revokeReviewer(actorUid, id);
          if (!assignment) {
            throw new AppError({
              statusCode: 404,
              code: 'REVIEWER_ASSIGNMENT_NOT_FOUND',
              message: '找不到審核人指派'
            });
          }
          return assignment;
        }
      );
    },
    { name: 'identity-module' }
  );
}

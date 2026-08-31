// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { AuditService } from './audit-service.js';
import type { AuditRepository } from './repository.js';
import type { AuditTargetType } from './types.js';
import { AuthorizationService } from '../identity/authorization-service.js';
import { parseCookieHeader } from '../identity/cookie.js';
import type { IdentityRepository } from '../identity/repository.js';
import { SessionService } from '../identity/session-service.js';
import type { AppConfig } from '../../shared/config/config.js';
import { AppError } from '../../shared/errors/app-error.js';

interface AuditModuleOptions {
  config: AppConfig;
  identityRepository: IdentityRepository;
  auditRepository: AuditRepository;
  clock?: () => Date;
}

interface AuditQuerystring {
  eventType?: string;
  actorUid?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export function createAuditModule(
  options: AuditModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(
    async (app) => {
      const clock = options.clock ?? (() => new Date());
      const audit = new AuditService(options.auditRepository, clock);
      const sessions = new SessionService({
        repository: options.identityRepository,
        clock
      });
      const authorization = new AuthorizationService(
        options.identityRepository,
        clock
      );

      app.get(
        '/api/audit/logs',
        {
          schema: {
            tags: ['audit'],
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                eventType: { type: 'string', minLength: 1, maxLength: 200 },
                actorUid: { type: 'string', minLength: 1, maxLength: 200 },
                targetType: {
                  type: 'string',
                  enum: ['package', 'version', 'user', 'role']
                },
                targetId: { type: 'string', minLength: 1, maxLength: 300 },
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
                cursor: { type: 'string', minLength: 1, maxLength: 1000 },
                limit: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 100,
                  default: 50
                }
              }
            }
          }
        },
        async (request) => {
          const cookies = parseCookieHeader(request.headers.cookie);
          const sessionToken = cookies.asp_session;
          const identity = await sessions.resolve({
            ...(sessionToken ? { sessionToken } : {})
          });
          if (identity.kind !== 'authenticated') {
            throw new AppError({
              statusCode: 401,
              code: 'AUTHENTICATION_REQUIRED',
              message: '請先登入'
            });
          }
          if (
            !(await authorization.hasRole(
              identity.uid,
              'platform_admin',
              { type: 'global' }
            ))
          ) {
            throw new AppError({
              statusCode: 403,
              code: 'FORBIDDEN',
              message: '沒有執行此操作的權限'
            });
          }

          const query = request.query as AuditQuerystring;
          const from = query.from ? new Date(query.from) : undefined;
          const to = query.to ? new Date(query.to) : undefined;
          if (from && to && from > to) {
            throw new AppError({
              statusCode: 400,
              code: 'INVALID_AUDIT_TIME_RANGE',
              message: '審計查詢開始時間不得晚於結束時間'
            });
          }
          return audit.list({
            ...(query.eventType ? { eventType: query.eventType } : {}),
            ...(query.actorUid ? { actorUid: query.actorUid } : {}),
            ...(query.targetType ? { targetType: query.targetType } : {}),
            ...(query.targetId ? { targetId: query.targetId } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(query.cursor ? { cursor: query.cursor } : {}),
            limit: query.limit ?? 50
          });
        }
      );
    },
    { name: 'audit-module' }
  );
}

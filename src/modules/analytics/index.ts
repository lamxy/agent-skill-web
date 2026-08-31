// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { AnalyticsService } from './analytics-service.js';
import type { AnalyticsRepository } from './repository.js';
import type { AnalyticsPeriod } from './types.js';
import { AuthorizationService } from '../identity/authorization-service.js';
import { parseCookieHeader } from '../identity/cookie.js';
import type { IdentityRepository } from '../identity/repository.js';
import { SessionService } from '../identity/session-service.js';
import { AppError } from '../../shared/errors/app-error.js';

export interface AnalyticsModuleOptions {
  repository: AnalyticsRepository;
  identityRepository: IdentityRepository;
  clock?: () => Date;
}

const rfc3339DateTime = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function parseDateTime(value: string): Date | undefined {
  const match = rfc3339DateTime.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function parsePeriod(query: { start: string; end: string }): AnalyticsPeriod {
  const start = parseDateTime(query.start);
  const end = parseDateTime(query.end);
  if (
    !start ||
    !end ||
    start.getTime() > end.getTime()
  ) {
    throw new AppError({
      statusCode: 400,
      code: 'INVALID_ANALYTICS_PERIOD',
      message: '分析期間無效'
    });
  }
  const maximumPeriodMilliseconds = 366 * 24 * 60 * 60 * 1_000;
  if (end.getTime() - start.getTime() > maximumPeriodMilliseconds) {
    throw new AppError({
      statusCode: 400,
      code: 'INVALID_ANALYTICS_PERIOD',
      message: '分析期間不得超過 366 天'
    });
  }
  return { start, end };
}

export function createAnalyticsModule(
  options: AnalyticsModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(async (app) => {
    const clock = options.clock ?? (() => new Date());
    const sessions = new SessionService({
      repository: options.identityRepository,
      clock
    });
    const service = new AnalyticsService(
      options.repository,
      new AuthorizationService(options.identityRepository, clock)
    );

    async function resolveIdentity(request: FastifyRequest) {
      const cookies = parseCookieHeader(request.headers.cookie);
      return sessions.resolve({
        ...(cookies.asp_session ? { sessionToken: cookies.asp_session } : {}),
        ...(cookies.asp_anonymous ? { anonymousId: cookies.asp_anonymous } : {})
      });
    }

    app.get(
      '/api/packages/:packageId/analytics',
      {
        schema: {
          tags: ['analytics'],
          params: {
            type: 'object',
            required: ['packageId'],
            additionalProperties: false,
            properties: {
              packageId: { type: 'string', minLength: 1, maxLength: 200 }
            }
          },
          querystring: {
            type: 'object',
            required: ['start', 'end'],
            additionalProperties: false,
            properties: {
              start: { type: 'string', minLength: 1, maxLength: 100 },
              end: { type: 'string', minLength: 1, maxLength: 100 }
            }
          }
        }
      },
      async (request) => {
        const params = request.params as { packageId: string };
        const query = request.query as { start: string; end: string };
        return service.getPackageAnalytics(
          params.packageId,
          parsePeriod(query),
          await resolveIdentity(request)
        );
      }
    );

    app.get(
      '/api/me/installations',
      { schema: { tags: ['analytics'] } },
      async (request) => service.getMyInstallations(await resolveIdentity(request))
    );
  }, { name: 'analytics-module' });
}

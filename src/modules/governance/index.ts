// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { CatalogRepository } from '../catalog/repository.js';
import { AuthorizationService } from '../identity/authorization-service.js';
import { parseCookieHeader } from '../identity/cookie.js';
import type { IdentityRepository } from '../identity/repository.js';
import { SessionService } from '../identity/session-service.js';
import type { ResolvedIdentity } from '../identity/types.js';
import type { AppConfig } from '../../shared/config/config.js';
import { GovernanceService } from './governance-service.js';
import type {
  GovernanceRepository,
  PublicationReviewStatus
} from './repository.js';
import {
  normalizeClientName,
  normalizeOsName
} from './validation-runner.js';
import type { ValidationRunner } from './validation-runner.js';

export interface GovernanceModuleOptions {
  config: AppConfig;
  repository: GovernanceRepository;
  catalogRepository: CatalogRepository;
  identityRepository: IdentityRepository;
  validationRunner: ValidationRunner;
  clock?: () => Date;
}

const packageVersionParams = {
  type: 'object', required: ['packageId', 'version'],
  additionalProperties: false,
  properties: {
    packageId: {
      type: 'string', minLength: 1, maxLength: 200,
      pattern: '^[a-z0-9][a-z0-9._-]*$'
    },
    version: { type: 'string', minLength: 1, maxLength: 100 }
  }
} as const;

const reviewParams = {
  type: 'object', required: ['id'], additionalProperties: false,
  properties: {
    id: {
      type: 'string', format: 'uuid', minLength: 1, maxLength: 100
    }
  }
} as const;

const emptyBody = {
  type: 'object', additionalProperties: false, maxProperties: 0
} as const;

function page<T>(items: T[], cursor: string | undefined, limit: number | undefined) {
  const parsed = cursor ? Number.parseInt(cursor, 10) : 0;
  const offset = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  const pageLimit = Math.min(Math.max(limit ?? 20, 1), 100);
  const selected = items.slice(offset, offset + pageLimit);
  const nextOffset = offset + selected.length;
  return {
    items: selected,
    ...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
    state: selected.length === 0 ? 'empty' as const : 'success' as const
  };
}

export function createGovernanceModule(
  options: GovernanceModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(async (app) => {
    const clock = options.clock ?? (() => new Date());
    const sessions = new SessionService({
      repository: options.identityRepository,
      clock
    });
    const service = new GovernanceService(
      options.repository,
      options.catalogRepository,
      new AuthorizationService(options.identityRepository, clock),
      options.validationRunner,
      clock
    );

    async function identityFrom(request: FastifyRequest): Promise<ResolvedIdentity> {
      const cookies = parseCookieHeader(request.headers.cookie);
      return sessions.resolve({
        ...(cookies.asp_session ? { sessionToken: cookies.asp_session } : {}),
        ...(cookies.asp_anonymous ? { anonymousId: cookies.asp_anonymous } : {})
      });
    }

    app.post(
      '/api/packages/:packageId/versions/:version/submit-review',
      { schema: { tags: ['governance'], params: packageVersionParams, body: emptyBody } },
      async (request) => {
        const params = request.params as { packageId: string; version: string };
        return service.submitReview(
          params.packageId, params.version, await identityFrom(request)
        );
      }
    );

    app.get(
      '/api/reviews',
      { schema: { tags: ['governance'], querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'superseded'] },
          os: { type: 'string', minLength: 1, maxLength: 50 },
          client: { type: 'string', minLength: 1, maxLength: 100 },
          cursor: { type: 'string', pattern: '^\\d+$', maxLength: 20 },
          limit: { type: 'integer', minimum: 1, maximum: 100 }
        }
      }}},
      async (request) => {
        const query = request.query as {
          status?: PublicationReviewStatus; os?: string; client?: string;
          cursor?: string; limit?: number;
        };
        const identity = await identityFrom(request);
        const reviews = await service.listReviews(
          { ...(query.status ? { status: query.status } : {}) }, identity
        );
        const workbenches = await Promise.all(reviews.map(async (review) =>
          service.findReviewWorkbench(review.id, identity)));
        const normalizedOs = query.os ? normalizeOsName(query.os) : undefined;
        const normalizedClient = query.client
          ? normalizeClientName(query.client)
          : undefined;
        return page(workbenches.filter((workbench) =>
          (!normalizedOs || workbench.version.supportedOs.some(
            (os) => normalizeOsName(os) === normalizedOs
          )) &&
          (!normalizedClient || workbench.version.supportedClients.some(
            (client) => normalizeClientName(client.name) === normalizedClient
          ))), query.cursor, query.limit);
      }
    );

    app.get(
      '/api/reviews/:id',
      { schema: { tags: ['governance'], params: reviewParams } },
      async (request) => service.findReviewWorkbench(
        (request.params as { id: string }).id, await identityFrom(request)
      )
    );

    app.post(
      '/api/reviews/:id/approve',
      { schema: { tags: ['governance'], params: reviewParams, body: {
        type: 'object', additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 5000 } }
      }}},
      async (request) => service.approveReview(
        (request.params as { id: string }).id,
        (request.body as { reason?: string } | undefined)?.reason?.trim() ?? '',
        await identityFrom(request)
      )
    );

    app.post(
      '/api/packages/:packageId/versions/:version/validation/retry',
      { schema: { tags: ['governance'], params: packageVersionParams, body: {
        type: 'object', additionalProperties: false,
        properties: {
          validationRunId: {
            type: 'string', format: 'uuid', minLength: 1, maxLength: 100
          }
        }
      }}},
      async (request) => {
        const params = request.params as { packageId: string; version: string };
        return service.retryValidationForVersion(
          params.packageId,
          params.version,
          (request.body as { validationRunId?: string } | undefined)?.validationRunId,
          await identityFrom(request)
        );
      }
    );

    app.post(
      '/api/reviews/:id/reject',
      { schema: { tags: ['governance'], params: reviewParams, body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 5000 }
        }
      }}},
      async (request) => service.rejectReview(
        (request.params as { id: string }).id,
        (request.body as { reason: string }).reason,
        await identityFrom(request)
      )
    );

    app.post(
      '/api/packages/:packageId/versions/:version/deprecate',
      { schema: { tags: ['governance'], params: packageVersionParams, body: {
        type: 'object', additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 5000 } }
      }}},
      async (request) => {
        const params = request.params as { packageId: string; version: string };
        return service.deprecateVersion(
          params.packageId,
          params.version,
          (request.body as { reason?: string } | undefined)?.reason,
          await identityFrom(request)
        );
      }
    );

    app.post(
      '/api/packages/:packageId/versions/:version/delist',
      { schema: { tags: ['governance'], params: packageVersionParams, body: {
        type: 'object', required: ['reasonCode', 'effectiveAt'],
        additionalProperties: false,
        properties: {
          reasonCode: { type: 'string', minLength: 1, maxLength: 200 },
          reasonDetail: { type: 'string', maxLength: 5000 },
          effectiveAt: { type: 'string', format: 'date-time' }
        }
      }}},
      async (request) => {
        const params = request.params as { packageId: string; version: string };
        const body = request.body as {
          reasonCode: string; reasonDetail?: string; effectiveAt: string;
        };
        return service.delistVersion(
          params.packageId,
          params.version,
          {
            reasonCode: body.reasonCode,
            ...(body.reasonDetail ? { reasonDetail: body.reasonDetail } : {}),
            effectiveAt: new Date(body.effectiveAt)
          },
          await identityFrom(request)
        );
      }
    );

    app.post(
      '/api/packages/:packageId/versions/:version/emergency-disable',
      { schema: { tags: ['governance'], params: packageVersionParams, body: {
        type: 'object', required: ['reasonCode'], additionalProperties: false,
        properties: {
          reasonCode: { type: 'string', minLength: 1, maxLength: 200 },
          reasonDetail: { type: 'string', maxLength: 5000 }
        }
      }}},
      async (request) => {
        const params = request.params as { packageId: string; version: string };
        const body = request.body as { reasonCode: string; reasonDetail?: string };
        return service.emergencyDisableVersion(
          params.packageId,
          params.version,
          body.reasonCode,
          body.reasonDetail,
          await identityFrom(request)
        );
      }
    );

    app.get(
      '/api/notifications',
      { schema: { tags: ['governance'], querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['unread', 'read'] },
          cursor: { type: 'string', pattern: '^\\d+$', maxLength: 20 },
          limit: { type: 'integer', minimum: 1, maximum: 100 }
        }
      }}},
      async (request) => {
        const query = request.query as {
          status?: 'unread' | 'read'; cursor?: string; limit?: number;
        };
        const notifications = await service.listNotifications(
          { ...(query.status ? { status: query.status } : {}) },
          await identityFrom(request)
        );
        return page(notifications, query.cursor, query.limit);
      }
    );

    app.post(
      '/api/notifications/:id/read',
      { schema: { tags: ['governance'], params: reviewParams, body: emptyBody } },
      async (request) => service.markNotificationRead(
        (request.params as { id: string }).id,
        await identityFrom(request)
      )
    );
  }, { name: 'governance-module' });
}

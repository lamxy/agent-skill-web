// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { AppConfig } from '../../shared/config/config.js';
import type { CatalogRepository } from '../catalog/repository.js';
import { AuthorizationService } from '../identity/authorization-service.js';
import { parseCookieHeader } from '../identity/cookie.js';
import type { IdentityRepository } from '../identity/repository.js';
import { SessionService } from '../identity/session-service.js';
import type { ResolvedIdentity } from '../identity/types.js';
import { ExperienceService } from './experience-service.js';
import type { ExperienceRepository } from './repository.js';
import {
  FEEDBACK_ISSUE_CATEGORIES,
  SUPPORT_CHANNEL_TYPES,
  type FeedbackIssueCategory,
  type FeedbackStatus,
  type SupportChannelContent
} from './types.js';

export interface ExperienceModuleOptions {
  config: AppConfig;
  repository: ExperienceRepository;
  catalogRepository: CatalogRepository;
  identityRepository: IdentityRepository;
  clock?: () => Date;
}

const packageIdParams = {
  type: 'object', required: ['packageId'], additionalProperties: false,
  properties: {
    packageId: {
      type: 'string', minLength: 1, maxLength: 200,
      pattern: '^[a-z0-9][a-z0-9._-]*$'
    }
  }
} as const;

const feedbackParams = {
  type: 'object', required: ['feedbackId'], additionalProperties: false,
  properties: {
    feedbackId: {
      type: 'string', format: 'uuid', minLength: 1, maxLength: 100
    }
  }
} as const;

const supportChannelsBody = {
  type: 'object', required: ['channels'], additionalProperties: false,
  properties: {
    channels: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object',
        required: ['channelType', 'label', 'address'],
        additionalProperties: false,
        properties: {
          channelType: { type: 'string', enum: SUPPORT_CHANNEL_TYPES },
          label: { type: 'string', minLength: 1, maxLength: 200 },
          address: { type: 'string', minLength: 1, maxLength: 2000 },
          instructions: { type: 'string', maxLength: 5000 },
          displayOrder: { type: 'integer', minimum: 0, maximum: 1000 }
        }
      }
    }
  }
} as const;

const feedbackBody = {
  type: 'object',
  required: ['version', 'satisfaction', 'issueCategory', 'detail'],
  additionalProperties: false,
  properties: {
    version: { type: 'string', minLength: 1, maxLength: 100 },
    satisfaction: { type: 'integer', minimum: 1, maximum: 5 },
    issueCategory: { type: 'string', enum: FEEDBACK_ISSUE_CATEGORIES },
    detail: { type: 'string', minLength: 1, maxLength: 5000 },
    needsHumanSupport: { type: 'boolean' }
  }
} as const;

export function createExperienceModule(
  options: ExperienceModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(async (app) => {
    const clock = options.clock ?? (() => new Date());
    const sessions = new SessionService({
      repository: options.identityRepository,
      clock
    });
    const service = new ExperienceService(
      options.repository,
      options.catalogRepository,
      new AuthorizationService(options.identityRepository, clock),
      clock
    );

    async function identityFrom(request: FastifyRequest): Promise<ResolvedIdentity> {
      const cookies = parseCookieHeader(request.headers.cookie);
      return sessions.resolve({
        ...(cookies.asp_session ? { sessionToken: cookies.asp_session } : {}),
        ...(cookies.asp_anonymous ? { anonymousId: cookies.asp_anonymous } : {})
      });
    }

    app.get('/api/packages/:packageId/support-channels', {
      schema: { tags: ['experience'], params: packageIdParams }
    }, async (request) => {
      const items = await service.listSupportChannels(
        (request.params as { packageId: string }).packageId,
        await identityFrom(request)
      );
      return { items, state: items.length === 0 ? 'empty' : 'success' };
    });

    app.put('/api/packages/:packageId/support-channels', {
      schema: {
        tags: ['experience'], params: packageIdParams, body: supportChannelsBody
      }
    }, async (request) => {
      const body = request.body as {
        channels: Array<Omit<SupportChannelContent, 'displayOrder'> & {
          displayOrder?: number;
        }>;
      };
      const items = await service.saveSupportChannels(
        (request.params as { packageId: string }).packageId,
        body.channels.map((channel, index) => ({
          ...channel,
          displayOrder: channel.displayOrder ?? index
        })),
        await identityFrom(request)
      );
      return { items, state: items.length === 0 ? 'empty' : 'success' };
    });

    app.post('/api/packages/:packageId/feedback', {
      schema: { tags: ['experience'], params: packageIdParams, body: feedbackBody }
    }, async (request, reply) => {
      const body = request.body as {
        version: string;
        satisfaction: number;
        issueCategory: FeedbackIssueCategory;
        detail: string;
        needsHumanSupport?: boolean;
      };
      return reply.status(201).send(await service.submitFeedback(
        {
          packageId: (request.params as { packageId: string }).packageId,
          version: body.version,
          satisfaction: body.satisfaction,
          issueCategory: body.issueCategory,
          detail: body.detail,
          needsHumanSupport: body.needsHumanSupport ?? false
        },
        await identityFrom(request)
      ));
    });

    app.get('/api/packages/:packageId/feedback', {
      schema: { tags: ['experience'], params: packageIdParams, querystring: {
        type: 'object', additionalProperties: false, properties: {
          version: { type: 'string', minLength: 1, maxLength: 100 },
          issueCategory: { type: 'string', enum: FEEDBACK_ISSUE_CATEGORIES },
          needsHumanSupport: { type: 'boolean' },
          status: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] }
        }
      }}
    }, async (request) => {
      const query = request.query as {
        version?: string;
        issueCategory?: FeedbackIssueCategory;
        needsHumanSupport?: boolean;
        status?: FeedbackStatus;
      };
      const items = await service.listFeedback(
        {
          packageId: (request.params as { packageId: string }).packageId,
          ...(query.version !== undefined ? { version: query.version } : {}),
          ...(query.issueCategory !== undefined
            ? { issueCategory: query.issueCategory } : {}),
          ...(query.needsHumanSupport !== undefined
            ? { needsHumanSupport: query.needsHumanSupport } : {}),
          ...(query.status !== undefined ? { status: query.status } : {})
        },
        await identityFrom(request)
      );
      return { items, state: items.length === 0 ? 'empty' : 'success' };
    });

    app.get('/api/packages/:packageId/feedback/summary', {
      schema: { tags: ['experience'], params: packageIdParams }
    }, async (request) => service.getFeedbackSummary(
      (request.params as { packageId: string }).packageId,
      await identityFrom(request)
    ));

    app.patch('/api/feedback/:feedbackId', {
      schema: { tags: ['experience'], params: feedbackParams, body: {
        type: 'object', required: ['status'], additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] }
        }
      }}
    }, async (request) => service.updateFeedbackStatus(
      (request.params as { feedbackId: string }).feedbackId,
      (request.body as { status: FeedbackStatus }).status,
      await identityFrom(request)
    ));
  }, { name: 'experience-module' });
}

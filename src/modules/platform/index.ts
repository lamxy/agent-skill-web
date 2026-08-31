// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { PlatformService } from './platform-service.js';
import type { PlatformRepository } from './repository.js';

export interface PlatformModuleOptions {
  repository: PlatformRepository;
}

const versionItem = {
  type: 'object',
  required: ['version', 'isAvailable', 'isCurrent', 'note', 'releasedAt'],
  additionalProperties: false,
  properties: {
    version: { type: 'string' },
    isAvailable: { type: 'boolean' },
    isCurrent: { type: 'boolean' },
    note: { type: ['string', 'null'] },
    releasedAt: { type: ['string', 'null'] }
  }
} as const;

const listResponse = {
  type: 'object',
  required: ['versions', 'currentVersion'],
  additionalProperties: false,
  properties: {
    versions: { type: 'array', items: versionItem },
    currentVersion: { type: ['string', 'null'] }
  }
} as const;

const availabilityResponse = {
  type: 'object',
  required: ['version', 'isAvailable', 'message', 'note', 'releasedAt'],
  additionalProperties: false,
  properties: {
    version: { type: 'string' },
    isAvailable: { type: 'boolean' },
    message: { type: 'string' },
    note: { type: ['string', 'null'] },
    releasedAt: { type: ['string', 'null'] }
  }
} as const;

export function createPlatformModule(
  options: PlatformModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(
    async (app) => {
      const service = new PlatformService(options.repository);

      app.get(
        '/api/platform/versions',
        { schema: { tags: ['platform'], response: { 200: listResponse } } },
        async () => {
          const { versions, currentVersion } = await service.listVersions();
          return {
            versions: versions.map(({ displayOrder: _ignored, ...rest }) => rest),
            currentVersion
          };
        }
      );

      app.get<{ Params: { version: string } }>(
        '/api/platform/versions/:version',
        {
          schema: {
            tags: ['platform'],
            params: {
              type: 'object',
              required: ['version'],
              properties: {
                version: { type: 'string', minLength: 1, maxLength: 64 }
              }
            },
            response: { 200: availabilityResponse }
          }
        },
        async (request) => service.checkAvailability(request.params.version)
      );
    },
    { name: 'platform-module' }
  );
}

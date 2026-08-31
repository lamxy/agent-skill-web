// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { TelemetryRepository } from './repository.js';
import { TelemetryService } from './telemetry-service.js';

export interface TelemetryModuleOptions {
  repository: TelemetryRepository;
  clock?: () => Date;
}

const telemetryBody = {
  type: 'object',
  required: [
    'idempotency_key',
    'package_id',
    'version',
    'user_ref',
    'user_ref_type',
    'os_type',
    'client_runtime',
    'status',
    'start_time',
    'end_time'
  ],
  additionalProperties: true,
  properties: {
    idempotency_key: { type: 'string', minLength: 1, maxLength: 64 },
    package_id: { type: 'string', minLength: 1, maxLength: 255 },
    version: { type: 'string', minLength: 1, maxLength: 255 },
    user_ref: { type: 'string', minLength: 1, maxLength: 255 },
    user_ref_type: { type: 'string', enum: ['uid', 'uuid'] },
    os_type: { type: 'string', enum: ['macos', 'linux', 'windows', 'wsl'] },
    client_runtime: { type: 'string', minLength: 1, maxLength: 255 },
    status: {
      type: 'string',
      enum: ['downloaded', 'succeeded', 'failed', 'uninstalled']
    },
    error_code: { type: 'string', minLength: 1, maxLength: 64 },
    start_time: { type: 'string', format: 'date-time' },
    end_time: { type: 'string', format: 'date-time' },
    script_version: { type: 'integer', minimum: 1, maximum: 2147483647 },
    options: {
      type: 'object',
      maxProperties: 20,
      propertyNames: {
        type: 'string',
        maxLength: 64,
        pattern: '^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'
      },
      additionalProperties: {
        anyOf: [
          { type: 'string', maxLength: 1000 },
          { type: 'boolean' }
        ]
      }
    }
  }
} as const;

const telemetryResponse = {
  type: 'object',
  required: ['duplicate', 'installationStatus', 'telemetrySyncStatus'],
  additionalProperties: false,
  properties: {
    duplicate: { type: 'boolean' },
    installationStatus: {
      type: 'string',
      enum: ['downloaded', 'succeeded', 'failed', 'uninstalled']
    },
    telemetrySyncStatus: { type: 'string', const: 'synced' }
  }
} as const;

export function createTelemetryModule(
  options: TelemetryModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(async (app) => {
    const service = new TelemetryService(options.repository, options.clock);

    app.post(
      '/api/telemetry/report',
      {
        schema: {
          tags: ['telemetry'],
          body: telemetryBody,
          response: { 200: telemetryResponse, 201: telemetryResponse }
        }
      },
      async (request, reply) => {
        const receipt = await service.ingest(
          request.body as Record<string, unknown>
        );
        if (receipt.droppedFields.length > 0) {
          request.log.warn(
            { droppedFields: receipt.droppedFields },
            '已丟棄遙測額外欄位'
          );
        }
        return reply.status(receipt.duplicate ? 200 : 201).send({
          duplicate: receipt.duplicate,
          installationStatus: receipt.record.status,
          telemetrySyncStatus: 'synced'
        });
      }
    );
  }, { name: 'telemetry-module' });
}

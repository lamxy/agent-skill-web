// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { ScriptGeneratorService } from './script-generator-service.js';
import { scriptTargetOsValues } from '../catalog/types.js';
import type { ScriptTargetOs } from './types.js';
import type { ClientRuntime } from '../catalog/types.js';
import { CatalogService } from '../catalog/catalog-service.js';
import type { CatalogRepository } from '../catalog/repository.js';
import { AuthorizationService } from '../identity/authorization-service.js';
import { parseCookieHeader } from '../identity/cookie.js';
import type { IdentityRepository } from '../identity/repository.js';
import { SessionService } from '../identity/session-service.js';
import { toInstallationUserReference } from '../identity/installation-user-reference.js';
import type { AppConfig } from '../../shared/config/config.js';
import { AppError } from '../../shared/errors/app-error.js';

interface ScriptGeneratorModuleOptions {
  config: AppConfig;
  catalogRepository: CatalogRepository;
  identityRepository: IdentityRepository;
  clock?: () => Date;
}

export function createScriptGeneratorModule(
  options: ScriptGeneratorModuleOptions
): FastifyPluginAsync {
  return fastifyPlugin(async (app) => {
    const clock = options.clock ?? (() => new Date());
    const sessions = new SessionService({ repository: options.identityRepository, clock });
    const catalog = new CatalogService(
      options.catalogRepository,
      new AuthorizationService(options.identityRepository, clock),
      clock
    );
    const generator = new ScriptGeneratorService();

    async function resolveIdentity(request: FastifyRequest) {
      const cookies = parseCookieHeader(request.headers.cookie);
      return sessions.resolve({
        ...(cookies.asp_session ? { sessionToken: cookies.asp_session } : {}),
        ...(cookies.asp_anonymous ? { anonymousId: cookies.asp_anonymous } : {})
      });
    }

    app.post('/api/packages/:packageId/versions/:version/scripts', {
      schema: {
        tags: ['script-generator'],
        params: {
          type: 'object', required: ['packageId', 'version'], additionalProperties: false,
          properties: {
            packageId: { type: 'string', minLength: 1, maxLength: 200 },
            version: { type: 'string', minLength: 1, maxLength: 100 }
          }
        },
        body: {
          type: 'object', required: ['targetOs', 'clientRuntime'], additionalProperties: false,
          properties: {
            targetOs: { type: 'string', enum: [...scriptTargetOsValues] },
            clientRuntime: { type: 'string', enum: ['claude-code', 'codex'] },
            action: { type: 'string', enum: ['install', 'uninstall'], default: 'install' },
            selectedOptions: {
              type: 'object', maxProperties: 20, additionalProperties: {
                anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'boolean' }]
              }
            }
          }
        }
      }
    }, async (request) => {
      const params = request.params as { packageId: string; version: string };
      const body = request.body as {
        targetOs: ScriptTargetOs;
        clientRuntime: ClientRuntime;
        action?: 'install' | 'uninstall';
        selectedOptions?: Record<string, string | boolean>;
      };
      const identity = await resolveIdentity(request);
      const detail = await catalog.getDetail(params.packageId, identity);
      const packageVersion = detail.versions.find(
        (candidate) => candidate.version === params.version && candidate.lifecycle === 'published'
      );
      if (!packageVersion) {
        throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到可生成腳本的已發佈版本' });
      }
      const activeTargets = (packageVersion.scriptTargets ?? []).filter((target) => !target.deletedAt);
      if (!activeTargets.some((target) => target.targetOs === body.targetOs)) {
        throw new AppError({ statusCode: 409, code: 'UNSUPPORTED_TARGET_OS', message: '此版本未聲明支援目標作業系統' });
      }
      if (!activeTargets.some((target) => target.clientRuntime === body.clientRuntime)) {
        throw new AppError({ statusCode: 409, code: 'UNSUPPORTED_CLIENT_RUNTIME', message: '此版本未聲明支援目標 Client runtime' });
      }
      const target = activeTargets.find((candidate) =>
        candidate.targetOs === body.targetOs && candidate.clientRuntime === body.clientRuntime);
      if (!target?.currentRevision) {
        throw new AppError({
          statusCode: 409, code: 'SCRIPT_TARGET_NOT_FOUND', message: '此版本沒有指定的腳本目標組合'
        });
      }
      return generator.generate({
        packageId: params.packageId,
        version: params.version,
        publishedAt: packageVersion.publishedAt ?? packageVersion.updatedAt,
        target,
        ...(body.action ? { action: body.action } : {}),
        ...(body.selectedOptions ? { selectedOptions: body.selectedOptions } : {}),
        userReference: toInstallationUserReference(identity),
        telemetryEndpoint: options.config.telemetryEndpoint ?? `http://${options.config.host}:${options.config.port}`
      });
    });
  }, { name: 'script-generator-module' });
}

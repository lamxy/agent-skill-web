// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { CatalogService } from './catalog-service.js';
import type { CatalogRepository } from './repository.js';
import type {
  CatalogSearchFilters,
  CopyScriptTargetRevisionInput,
  CreatePackageInput,
  CreatePackageVersionInput,
  CreateScriptTargetInput,
  MaintainedPackageFilters,
  SaveScriptTargetRevisionInput,
  SetPackageGradeInput,
  UpdatePackageInput,
  UpdatePackageVersionInput
} from './types.js';
import {
  maintainedScopeValues,
  packageCategoryCodeValues,
  packageGradeValues,
  packageSourceValues,
  publisherKindValues
} from './types.js';
import { AuthorizationService } from '../identity/authorization-service.js';
import { parseCookieHeader } from '../identity/cookie.js';
import type { IdentityRepository } from '../identity/repository.js';
import { SessionService } from '../identity/session-service.js';
import type { ResolvedIdentity } from '../identity/types.js';
import type { AppConfig } from '../../shared/config/config.js';
import type { GovernanceRepository } from '../governance/repository.js';
import { AppError } from '../../shared/errors/app-error.js';

interface CatalogModuleOptions {
  config: AppConfig;
  catalogRepository: CatalogRepository;
  identityRepository: IdentityRepository;
  governanceRepository?: GovernanceRepository;
  clock?: () => Date;
}

const packageIdParams = {
  type: 'object', required: ['packageId'], additionalProperties: false,
  properties: { packageId: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[a-z0-9][a-z0-9._-]*$' } }
} as const;

const versionParams = {
  type: 'object', required: ['packageId', 'version'], additionalProperties: false,
  properties: {
    packageId: packageIdParams.properties.packageId,
    version: { type: 'string', minLength: 1, maxLength: 100 }
  }
} as const;

const scriptTargetParams = {
  type: 'object', required: ['packageId', 'version', 'targetId'], additionalProperties: false,
  properties: {
    ...versionParams.properties,
    targetId: { type: 'string', minLength: 1, maxLength: 200 }
  }
} as const;

/**
 * 分類標籤欄位（Task 17）。建立與更新共用同一份定義，
 * 兩處若各寫一份，遲早會出現只有其中一邊接受某個值的情況。
 *
 * 不含 grade：分級只能由 PATCH /grade 交給審核人設定。
 */
const taxonomyProperties = {
  categoryCode: { type: 'string', enum: [...packageCategoryCodeValues] },
  source: { type: 'string', enum: [...packageSourceValues] },
  publisher: {
    type: 'object',
    required: ['kind', 'name'],
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: [...publisherKindValues] },
      name: { type: 'string', maxLength: 200 }
    }
  }
} as const;

function versionProperties() {
  return {
    releaseNotes: { type: 'string', maxLength: 10000 },
    lifecycle: {
      not: {},
      description: '版本生命週期只能由發布治理流程變更'
    },
    scriptDigest: { type: 'string', maxLength: 300 }
  } as const;
}

const scriptOptionSchema = {
  type: 'object',
  required: ['name', 'type', 'description', 'defaultValue'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 64 },
    type: { type: 'string', enum: ['select', 'boolean', 'text'] },
    description: { type: 'string', minLength: 1, maxLength: 1000 },
    defaultValue: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'boolean' }] },
    choices: {
      type: 'array', minItems: 1, maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 1000 }
    }
  }
} as const;

const scriptRevisionBody = {
  type: 'object',
  required: [
    'expectedScriptVersion', 'installCommand', 'uninstallCommand',
    'options', 'usageInstructions', 'hasResidualEffects'
  ],
  additionalProperties: false,
  properties: {
    expectedScriptVersion: { type: 'integer', minimum: 0 },
    installCommand: { type: 'string', minLength: 1, maxLength: 100000 },
    uninstallCommand: { type: 'string', minLength: 1, maxLength: 100000 },
    options: { type: 'array', maxItems: 20, items: scriptOptionSchema },
    usageInstructions: { type: 'string', minLength: 1, maxLength: 10000 },
    hasResidualEffects: { type: 'boolean' },
    residualDescription: { type: 'string', maxLength: 10000 },
    manualCleanupSteps: { type: 'string', maxLength: 10000 },
    changeDescription: { type: 'string', maxLength: 10000 }
  }
} as const;

export function createCatalogModule(options: CatalogModuleOptions): FastifyPluginAsync {
  return fastifyPlugin(async (app) => {
    const clock = options.clock ?? (() => new Date());
    const sessions = new SessionService({ repository: options.identityRepository, clock });
    const service = new CatalogService(
      options.catalogRepository,
      new AuthorizationService(options.identityRepository, clock),
      clock,
      options.governanceRepository
    );

    async function identityFrom(request: FastifyRequest): Promise<ResolvedIdentity> {
      const cookies = parseCookieHeader(request.headers.cookie);
      return sessions.resolve({
        ...(cookies.asp_session ? { sessionToken: cookies.asp_session } : {}),
        ...(cookies.asp_anonymous ? { anonymousId: cookies.asp_anonymous } : {})
      });
    }

    app.get('/api/packages', { schema: { tags: ['catalog'], querystring: {
      type: 'object', additionalProperties: false, properties: {
        keyword: { type: 'string', maxLength: 200 }, category: { type: 'string', maxLength: 100 },
        categoryCode: taxonomyProperties.categoryCode,
        grade: { type: 'string', enum: [...packageGradeValues] },
        source: taxonomyProperties.source,
        client: { type: 'string', maxLength: 100 }, os: { type: 'string', maxLength: 50 },
        cursor: { type: 'string', maxLength: 50 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
        sort: { type: 'string', enum: ['name_asc', 'name_desc', 'updated_desc'] }
      }
    }}}, async (request) => service.search(request.query as CatalogSearchFilters, await identityFrom(request)));

    app.post('/api/packages', { schema: { tags: ['catalog'], body: {
      type: 'object',
      /*
       * sourceUri 與 license 不在必填之列：內部技能未必有可公開的來源
       * 位址，也未必挑過授權條款。強制填寫只會逼人亂填，反而讓欄位
       * 失去意義。兩者留空時以空字串保存。
       */
      /*
       * publisher 不再必填：發布者資訊完全由 ownerTeam 推導，前端不需要
       * 重複填一次組織名。仍接受顯式傳入，讓既有整合不必同步修改。
       */
      required: [
        'packageId', 'type', 'name', 'purpose', 'ownerTeam', 'category',
        'categoryCode', 'visibility', 'source'
      ],
      additionalProperties: false, properties: {
        packageId: packageIdParams.properties.packageId, type: { type: 'string', enum: ['skill', 'tool'] },
        name: { type: 'string', minLength: 1, maxLength: 200 }, purpose: { type: 'string', minLength: 1, maxLength: 5000 },
        ownerTeam: { type: 'string', minLength: 1, maxLength: 200 }, category: { type: 'string', minLength: 1, maxLength: 100 },
        visibility: { type: 'string', enum: ['public', 'internal'] }, sourceUri: { type: 'string', maxLength: 2000 },
        license: { type: 'string', maxLength: 200 },
        ...taxonomyProperties
      }
    }}}, async (request, reply) => reply.status(201).send(await service.createPackage(request.body as CreatePackageInput, await identityFrom(request))));

    /*
     * 必須註冊在 /api/packages/:packageId 之前，否則 mine 會被當成 packageId
     * 落入詳情路由，回傳 404 而非清單。
     */
    app.get('/api/packages/mine', { schema: { tags: ['catalog'], querystring: {
      type: 'object', additionalProperties: false, properties: {
        scope: { type: 'string', enum: [...maintainedScopeValues] },
        // scope 之前的參數，等價於 scope: 'all'
        includeAllTeams: { type: 'boolean' },
        cursor: { type: 'string', maxLength: 64 }
      }
    }}}, async (request) => service.listMaintainedPackages(
      request.query as MaintainedPackageFilters, await identityFrom(request)
    ));

    app.get('/api/packages/:packageId', { schema: { tags: ['catalog'], params: packageIdParams } }, async (request) => ({
      state: 'success', ...(await service.getDetail((request.params as { packageId: string }).packageId, await identityFrom(request)))
    }));

    app.patch('/api/packages/:packageId', { schema: { tags: ['catalog'], params: packageIdParams, body: {
      type: 'object', minProperties: 1, additionalProperties: false, properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 }, purpose: { type: 'string', minLength: 1, maxLength: 5000 },
        ownerTeam: { type: 'string', minLength: 1, maxLength: 200 }, category: { type: 'string', minLength: 1, maxLength: 100 },
        visibility: { type: 'string', enum: ['public', 'internal'] }, sourceUri: { type: 'string', maxLength: 2000 },
        license: { type: 'string', maxLength: 200 },
        ...taxonomyProperties
      }
    }}}, async (request) => service.updatePackage((request.params as { packageId: string }).packageId, request.body as UpdatePackageInput, await identityFrom(request)));

    /*
     * 分級核定獨立於 PATCH /:packageId：兩者權限不同。
     * 前者要維護權限，此處要審核權限；併在同一個端點就無法只靠 schema 區分。
     */
    app.patch('/api/packages/:packageId/grade', { schema: { tags: ['catalog'], params: packageIdParams, body: {
      type: 'object', required: ['grade'], additionalProperties: false, properties: {
        grade: { type: 'string', enum: [...packageGradeValues] }
      }
    }}}, async (request) => service.setPackageGrade(
      (request.params as { packageId: string }).packageId,
      request.body as SetPackageGradeInput,
      await identityFrom(request)
    ));

    app.delete('/api/packages/:packageId', { schema: { tags: ['catalog'], params: packageIdParams } }, async (request) =>
      service.archivePackage((request.params as { packageId: string }).packageId, await identityFrom(request)));

    app.post('/api/packages/:packageId/versions', {
      preValidation: async (request) => {
        if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
          return;
        }
        const body = request.body as Record<string, unknown>;
        if (Object.keys(body).some((key) => key !== 'version' && key !== 'releaseNotes')) {
          throw new AppError({
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: '建立版本只接受 version 與 releaseNotes'
          });
        }
      },
      schema: { tags: ['catalog'], params: packageIdParams, body: {
        type: 'object', required: ['version'],
        additionalProperties: false, properties: {
          version: { type: 'string', minLength: 1, maxLength: 100 },
          releaseNotes: { type: 'string', maxLength: 10000 }
        }
      }}
    }, async (request, reply) => reply.status(201).send(await service.createVersion(
      (request.params as { packageId: string }).packageId, request.body as CreatePackageVersionInput, await identityFrom(request)
    )));

    app.patch('/api/packages/:packageId/versions/:version', { schema: { tags: ['catalog'], params: versionParams, body: {
      type: 'object', minProperties: 1, additionalProperties: false, properties: versionProperties()
    }}}, async (request) => {
      const params = request.params as { packageId: string; version: string };
      return service.updateVersion(params.packageId, params.version, request.body as UpdatePackageVersionInput, await identityFrom(request));
    });

    app.get('/api/packages/:packageId/versions/:version', {
      schema: { tags: ['catalog'], params: versionParams }
    }, async (request) => {
      const params = request.params as { packageId: string; version: string };
      return service.getVersion(params.packageId, params.version, await identityFrom(request));
    });

    app.post('/api/packages/:packageId/versions/:version/script-targets', {
      schema: { tags: ['catalog'], params: versionParams, body: {
        type: 'object', required: ['targetOs', 'clientRuntime'], additionalProperties: false,
        properties: {
          targetOs: { type: 'string', enum: ['linux/macos', 'windows', 'wsl'] },
          clientRuntime: { type: 'string', enum: ['claude-code', 'codex'] }
        }
      }}
    }, async (request, reply) => {
      const params = request.params as { packageId: string; version: string };
      return reply.status(201).send(await service.createScriptTarget(
        params.packageId,
        params.version,
        request.body as CreateScriptTargetInput,
        await identityFrom(request)
      ));
    });

    app.put('/api/packages/:packageId/versions/:version/script-targets/:targetId', {
      schema: { tags: ['catalog'], params: scriptTargetParams, body: scriptRevisionBody }
    }, async (request) => {
      const params = request.params as { packageId: string; version: string; targetId: string };
      return service.saveScriptTargetRevision(
        params.packageId,
        params.version,
        params.targetId,
        request.body as SaveScriptTargetRevisionInput,
        await identityFrom(request)
      );
    });

    app.post('/api/packages/:packageId/versions/:version/script-targets/:targetId/copy-from', {
      schema: { tags: ['catalog'], params: scriptTargetParams, body: {
        type: 'object', required: ['sourceTargetId', 'expectedScriptVersion'], additionalProperties: false,
        properties: {
          sourceTargetId: { type: 'string', minLength: 1, maxLength: 200 },
          expectedScriptVersion: { type: 'integer', minimum: 0 },
          changeDescription: { type: 'string', maxLength: 10000 }
        }
      }}
    }, async (request) => {
      const params = request.params as { packageId: string; version: string; targetId: string };
      return service.copyScriptTargetRevision(
        params.packageId,
        params.version,
        params.targetId,
        request.body as CopyScriptTargetRevisionInput,
        await identityFrom(request)
      );
    });

    app.delete('/api/packages/:packageId/versions/:version/script-targets/:targetId', {
      schema: { tags: ['catalog'], params: scriptTargetParams, body: {
        type: 'object', required: ['expectedScriptVersion'], additionalProperties: false,
        properties: { expectedScriptVersion: { type: 'integer', minimum: 0 } }
      }}
    }, async (request) => {
      const params = request.params as { packageId: string; version: string; targetId: string };
      return service.softDeleteScriptTarget(
        params.packageId,
        params.version,
        params.targetId,
        (request.body as { expectedScriptVersion: number }).expectedScriptVersion,
        await identityFrom(request)
      );
    });

    app.get('/api/packages/:packageId/versions/:version/script-targets/:targetId/revisions', {
      schema: { tags: ['catalog'], params: scriptTargetParams }
    }, async (request) => {
      const params = request.params as { packageId: string; version: string; targetId: string };
      return service.getScriptTargetRevisions(
        params.packageId,
        params.version,
        params.targetId,
        await identityFrom(request)
      );
    });

    app.get('/api/packages/:packageId/versions/:version/diff/:targetVersion', {
      schema: { tags: ['catalog'], params: {
        type: 'object', required: ['packageId', 'version', 'targetVersion'],
        additionalProperties: false,
        properties: {
          ...versionParams.properties,
          targetVersion: { type: 'string', minLength: 1, maxLength: 100 }
        }
      }}
    }, async (request) => {
      const params = request.params as {
        packageId: string; version: string; targetVersion: string;
      };
      return service.getVersionDiff(
        params.packageId,
        params.version,
        params.targetVersion,
        await identityFrom(request)
      );
    });

    app.get('/api/packages/:packageId/versions/:version/download', { schema: { tags: ['catalog'], params: versionParams } }, async (request) => {
      const params = request.params as { packageId: string; version: string };
      return service.getDownload(params.packageId, params.version, await identityFrom(request));
    });
  }, { name: 'catalog-module' });
}

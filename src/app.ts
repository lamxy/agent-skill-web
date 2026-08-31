// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync
} from 'fastify';

import { createAnalyticsModule } from './modules/analytics/index.js';
import { MemoryAnalyticsRepository } from './modules/analytics/memory-analytics-repository.js';
import { PostgresAnalyticsRepository } from './modules/analytics/postgres-analytics-repository.js';
import type { AnalyticsRepository } from './modules/analytics/repository.js';
import { createAuditModule } from './modules/audit/index.js';
import { MemoryAuditRepository } from './modules/audit/memory-audit-repository.js';
import { PostgresAuditRepository } from './modules/audit/postgres-audit-repository.js';
import type { AuditRepository } from './modules/audit/repository.js';
import { createCatalogModule } from './modules/catalog/index.js';
import { MemoryCatalogRepository } from './modules/catalog/memory-catalog-repository.js';
import { PostgresCatalogRepository } from './modules/catalog/postgres-catalog-repository.js';
import type { CatalogRepository } from './modules/catalog/repository.js';
import { createExperienceModule } from './modules/experience/index.js';
import { MemoryExperienceRepository } from './modules/experience/memory-experience-repository.js';
import { PostgresExperienceRepository } from './modules/experience/postgres-experience-repository.js';
import type { ExperienceRepository } from './modules/experience/repository.js';
import { createGovernanceModule } from './modules/governance/index.js';
import { MemoryGovernanceRepository } from './modules/governance/memory-governance-repository.js';
import { PostgresGovernanceRepository } from './modules/governance/postgres-governance-repository.js';
import type { GovernanceRepository } from './modules/governance/repository.js';
import { ValidationRunnerRegistry } from './modules/governance/validation-runner-registry.js';
import type { ValidationRunner } from './modules/governance/validation-runner.js';
import type { IdentityProvider } from './modules/identity/identity-provider.js';
import { createIdentityModule } from './modules/identity/index.js';
import { MemoryIdentityRepository } from './modules/identity/memory-identity-repository.js';
import { PostgresIdentityRepository } from './modules/identity/postgres-identity-repository.js';
import type { IdentityRepository } from './modules/identity/repository.js';
import { createPlatformModule } from './modules/platform/index.js';
import { MemoryPlatformRepository } from './modules/platform/memory-platform-repository.js';
import { PostgresPlatformRepository } from './modules/platform/postgres-platform-repository.js';
import type { PlatformRepository } from './modules/platform/repository.js';
import { createScriptGeneratorModule } from './modules/script-generator/index.js';
import { createTelemetryModule } from './modules/telemetry/index.js';
import { MemoryTelemetryRepository } from './modules/telemetry/memory-telemetry-repository.js';
import { PostgresTelemetryRepository } from './modules/telemetry/postgres-telemetry-repository.js';
import type { TelemetryRepository } from './modules/telemetry/repository.js';
import type { AppConfig } from './shared/config/config.js';
import type { Database } from './shared/database/database.js';
import { isPostgresDatabase } from './shared/database/postgres-database.js';
import { registerErrorHandler } from './shared/errors/error-handler.js';
import { registerStaticSite } from './shared/web/static-site.js';

interface CreateAppOptions {
  config: AppConfig;
  database: Database;
  modules?: FastifyPluginAsync[];
  identity?: {
    repository?: IdentityRepository;
    provider?: IdentityProvider;
  };
  audit?: {
    repository?: AuditRepository;
  };
  catalog?: {
    repository?: CatalogRepository;
  };
  governance?: {
    repository?: GovernanceRepository;
    validationRunner?: ValidationRunner;
    clock?: () => Date;
  };
  telemetry?: {
    repository?: TelemetryRepository;
    clock?: () => Date;
  };
  analytics?: {
    repository?: AnalyticsRepository;
    clock?: () => Date;
  };
  experience?: {
    repository?: ExperienceRepository;
    clock?: () => Date;
  };
  platform?: {
    repository?: PlatformRepository;
  };
}

function createDefaultModules(options: CreateAppOptions): FastifyPluginAsync[] {
  const postgresDatabase = isPostgresDatabase(options.database)
    ? options.database
    : undefined;
  const auditRepository =
    options.audit?.repository ??
    (postgresDatabase
      ? new PostgresAuditRepository(postgresDatabase.client)
      : new MemoryAuditRepository());
  const identityRepository =
    options.identity?.repository ??
    (postgresDatabase
      ? new PostgresIdentityRepository(postgresDatabase.client)
      : new MemoryIdentityRepository({ auditRepository }));
  const catalogRepository =
    options.catalog?.repository ??
    (postgresDatabase
      ? new PostgresCatalogRepository(postgresDatabase.client)
      : new MemoryCatalogRepository());
  const governanceRepository =
    options.governance?.repository ??
    (postgresDatabase
      ? new PostgresGovernanceRepository(postgresDatabase.client)
      : new MemoryGovernanceRepository({
          ...(catalogRepository instanceof MemoryCatalogRepository
            ? { store: catalogRepository.store }
            : {})
        }));
  const telemetryRepository =
    options.telemetry?.repository ??
    (postgresDatabase
      ? new PostgresTelemetryRepository(postgresDatabase.client)
      : new MemoryTelemetryRepository(
          catalogRepository instanceof MemoryCatalogRepository
            ? catalogRepository.store
            : new MemoryCatalogRepository().store
        ));
  const analyticsRepository =
    options.analytics?.repository ??
    (postgresDatabase
      ? new PostgresAnalyticsRepository(postgresDatabase.client)
      : new MemoryAnalyticsRepository(
          catalogRepository instanceof MemoryCatalogRepository
            ? catalogRepository.store
            : new MemoryCatalogRepository().store
        ));
  const experienceRepository =
    options.experience?.repository ??
    (postgresDatabase
      ? new PostgresExperienceRepository(postgresDatabase.client)
      : new MemoryExperienceRepository());
  const platformRepository =
    options.platform?.repository ??
    (postgresDatabase
      ? new PostgresPlatformRepository(postgresDatabase.client)
      : new MemoryPlatformRepository());
  return [
    createIdentityModule({
      config: options.config,
      repository: identityRepository,
      ...(options.identity?.provider
        ? { provider: options.identity.provider }
        : {})
    }),
    createCatalogModule({
      config: options.config,
      catalogRepository,
      identityRepository,
      governanceRepository
    }),
    createScriptGeneratorModule({
      config: options.config,
      catalogRepository,
      identityRepository
    }),
    createGovernanceModule({
      config: options.config,
      repository: governanceRepository,
      catalogRepository,
      identityRepository,
      validationRunner:
        options.governance?.validationRunner ?? new ValidationRunnerRegistry(),
      ...(options.governance?.clock
        ? { clock: options.governance.clock }
        : {})
    }),
    createTelemetryModule({
      repository: telemetryRepository,
      ...(options.telemetry?.clock ? { clock: options.telemetry.clock } : {})
    }),
    createAnalyticsModule({
      repository: analyticsRepository,
      identityRepository,
      ...(options.analytics?.clock ? { clock: options.analytics.clock } : {})
    }),
    createExperienceModule({
      config: options.config,
      repository: experienceRepository,
      catalogRepository,
      identityRepository,
      ...(options.experience?.clock ? { clock: options.experience.clock } : {})
    }),
    createPlatformModule({ repository: platformRepository }),
    createAuditModule({
      config: options.config,
      identityRepository,
      auditRepository
    })
  ];
}

export async function createApp(
  options: CreateAppOptions
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.config.logLevel === 'silent'
        ? false
        : { level: options.config.logLevel }
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Agent 技能交付控制面 API',
        description: '可信技能發現、發布、安裝與遙測 API',
        version: '0.1.0'
      }
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerErrorHandler(app);

  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            required: ['status', 'database'],
            properties: {
              status: { type: 'string', const: 'ok' },
              database: { type: 'string', const: 'up' }
            }
          },
          503: {
            type: 'object',
            required: ['status', 'database'],
            properties: {
              status: { type: 'string', const: 'degraded' },
              database: { type: 'string', const: 'down' }
            }
          }
        }
      }
    },
    async (_request, reply) => {
      try {
        await options.database.ping();
        return { status: 'ok', database: 'up' };
      } catch {
        return reply
          .status(503)
          .send({ status: 'degraded', database: 'down' });
      }
    }
  );

  for (const domainModule of options.modules ?? createDefaultModules(options)) {
    await app.register(domainModule);
  }

  // 必須在 API 模組之後：SPA fallback 會接管未匹配的頁面請求
  await registerStaticSite(app);

  app.addHook('onClose', async () => options.database.close());

  return app;
}

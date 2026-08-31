// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';
import { ExperienceService } from '../../src/modules/experience/experience-service.js';
import { MemoryExperienceRepository } from '../../src/modules/experience/memory-experience-repository.js';
import { AuthorizationService } from '../../src/modules/identity/authorization-service.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import type { ResolvedIdentity } from '../../src/modules/identity/types.js';

const now = new Date('2026-08-29T00:00:00.000Z');

const anonymous: ResolvedIdentity = {
  kind: 'anonymous',
  anonymousId: '123e4567-e89b-42d3-a456-426614174000',
  isNew: false
};
const maintainer: ResolvedIdentity = {
  kind: 'authenticated',
  uid: 'maintainer-1',
  displayName: '維護者一',
  teamIds: ['team-a']
};
const employee: ResolvedIdentity = {
  kind: 'authenticated',
  uid: 'employee-1',
  displayName: '員工一',
  teamIds: ['team-b']
};

function createService() {
  const catalog = new MemoryCatalogRepository({
    packages: [
      {
        packageId: 'public-skill',
        type: 'skill',
        name: '前端品質技能',
        purpose: '檢查前端品質',
        ownerTeam: 'team-a',
        category: 'frontend',
        visibility: 'public',
        sourceUri: 'https://example.invalid/public-skill',
        license: 'MIT',
        lifecycle: 'active',
        createdAt: now,
        updatedAt: now
      },
      {
        packageId: 'internal-tool',
        type: 'tool',
        name: '內部部署工具',
        purpose: '部署內部服務',
        ownerTeam: 'team-a',
        category: 'backend',
        visibility: 'internal',
        sourceUri: 'https://example.invalid/internal-tool',
        license: 'Apache-2.0',
        lifecycle: 'active',
        createdAt: now,
        updatedAt: now
      }
    ],
    versions: [
      {
        id: '1',
        packageId: 'public-skill',
        version: '1.0.0',
        supportedOs: ['linux'],
        supportedClients: [
          { name: 'codex', adaptationSource: 'publisher', maintainer: 'team-a' }
        ],
        lifecycle: 'published',
        installCommand: 'install public',
        uninstallCommand: 'uninstall public',
        hasResidualEffects: false,
        authorUid: 'maintainer-1',
        createdAt: now,
        updatedAt: now
      },
      {
        id: '2',
        packageId: 'internal-tool',
        version: '2.0.0',
        supportedOs: ['linux'],
        supportedClients: [
          { name: 'codex', adaptationSource: 'publisher', maintainer: 'team-a' }
        ],
        lifecycle: 'published',
        installCommand: 'install internal',
        uninstallCommand: 'uninstall internal',
        hasResidualEffects: false,
        authorUid: 'maintainer-1',
        createdAt: now,
        updatedAt: now
      }
    ]
  });
  const identities = new MemoryIdentityRepository({
    identities: [
      {
        uid: 'maintainer-1',
        displayName: '維護者一',
        teamIds: ['team-a'],
        providerType: 'development',
        active: true,
        createdAt: now,
        updatedAt: now
      },
      {
        uid: 'employee-1',
        displayName: '員工一',
        teamIds: ['team-b'],
        providerType: 'development',
        active: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    roles: [
      {
        id: '123e4567-e89b-42d3-a456-426614174088',
        uid: 'maintainer-1',
        role: 'maintainer',
        scopeType: 'team',
        scopeValue: 'team-a',
        assignedByUid: 'admin-1',
        active: true,
        createdAt: now
      }
    ]
  });
  return new ExperienceService(
    new MemoryExperienceRepository(),
    catalog,
    new AuthorizationService(identities, () => now),
    () => now
  );
}

const imChannel = {
  channelType: 'im_group' as const,
  label: '技能支援群',
  address: 'https://im.example.invalid/g/skill-support',
  displayOrder: 0
};

describe('support channels', () => {
  it('lets any visitor read a public package support entry', async () => {
    const service = createService();
    await service.saveSupportChannels('public-skill', [imChannel], maintainer);

    const channels = await service.listSupportChannels('public-skill', anonymous);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.label).toBe('技能支援群');
  });

  it('hides internal packages from anonymous visitors', async () => {
    const service = createService();
    await expect(
      service.listSupportChannels('internal-tool', anonymous)
    ).rejects.toMatchObject({ statusCode: 404, code: 'PACKAGE_NOT_FOUND' });
  });

  it('rejects non-maintainer writes', async () => {
    const service = createService();
    await expect(
      service.saveSupportChannels('public-skill', [imChannel], employee)
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('replaces the whole set so removed channels disappear', async () => {
    const service = createService();
    await service.saveSupportChannels(
      'public-skill',
      [
        imChannel,
        {
          channelType: 'email',
          label: '支援信箱',
          address: 'support@example.invalid',
          displayOrder: 1
        }
      ],
      maintainer
    );
    const remaining = await service.saveSupportChannels(
      'public-skill', [imChannel], maintainer
    );

    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.channelType).toBe('im_group');
  });

  it('rejects duplicate address within the same channel type', async () => {
    const service = createService();
    await expect(
      service.saveSupportChannels(
        'public-skill',
        [imChannel, { ...imChannel, label: '重複群', displayOrder: 1 }],
        maintainer
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  it('rejects blank label or address', async () => {
    const service = createService();
    await expect(
      service.saveSupportChannels(
        'public-skill', [{ ...imChannel, label: '   ' }], maintainer
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });
});

const feedbackInput = {
  packageId: 'public-skill',
  version: '1.0.0',
  satisfaction: 4,
  issueCategory: 'documentation' as const,
  detail: '使用說明缺少 WSL 的前置條件。',
  needsHumanSupport: false
};

describe('structured feedback', () => {
  it('accepts anonymous submissions and records the uuid reference', async () => {
    const service = createService();
    const record = await service.submitFeedback(feedbackInput, anonymous);

    expect(record.authorRefType).toBe('uuid');
    expect(record.authorRef).toBe(anonymous.anonymousId);
    expect(record.status).toBe('open');
  });

  it('records the uid for authenticated submissions', async () => {
    const service = createService();
    const record = await service.submitFeedback(feedbackInput, employee);

    expect(record.authorRefType).toBe('uid');
    expect(record.authorRef).toBe('employee-1');
  });

  it('rejects feedback for a version that does not exist', async () => {
    const service = createService();
    await expect(
      service.submitFeedback({ ...feedbackInput, version: '9.9.9' }, employee)
    ).rejects.toMatchObject({
      statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND'
    });
  });

  it('rejects whitespace-only detail', async () => {
    const service = createService();
    await expect(
      service.submitFeedback({ ...feedbackInput, detail: '   ' }, employee)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  it('keeps feedback detail readable only by maintainers', async () => {
    const service = createService();
    await service.submitFeedback(feedbackInput, employee);

    await expect(
      service.listFeedback({ packageId: 'public-skill' }, employee)
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    await expect(
      service.listFeedback({ packageId: 'public-skill' }, anonymous)
    ).rejects.toMatchObject({
      statusCode: 401, code: 'AUTHENTICATION_REQUIRED'
    });
    await expect(
      service.listFeedback({ packageId: 'public-skill' }, maintainer)
    ).resolves.toHaveLength(1);
  });

  it('filters by category and human support flag', async () => {
    const service = createService();
    await service.submitFeedback(feedbackInput, employee);
    await service.submitFeedback(
      {
        ...feedbackInput,
        issueCategory: 'install_failure',
        detail: '安裝在 WSL 失敗。',
        needsHumanSupport: true
      },
      employee
    );

    await expect(
      service.listFeedback(
        { packageId: 'public-skill', needsHumanSupport: true }, maintainer
      )
    ).resolves.toHaveLength(1);
    await expect(
      service.listFeedback(
        { packageId: 'public-skill', issueCategory: 'documentation' }, maintainer
      )
    ).resolves.toHaveLength(1);
  });

  it('summarizes satisfaction and outstanding support requests', async () => {
    const service = createService();
    await service.submitFeedback(feedbackInput, employee);
    await service.submitFeedback(
      {
        ...feedbackInput,
        satisfaction: 2,
        issueCategory: 'install_failure',
        detail: '安裝失敗。',
        needsHumanSupport: true
      },
      anonymous
    );

    const summary = await service.getFeedbackSummary('public-skill', maintainer);
    expect(summary.total).toBe(2);
    expect(summary.averageSatisfaction).toBe(3);
    expect(summary.needsHumanSupport).toBe(1);
    expect(summary.openNeedsHumanSupport).toBe(1);
    expect(summary.byCategory).toHaveLength(7);
  });

  it('stops counting resolved requests as outstanding', async () => {
    const service = createService();
    const record = await service.submitFeedback(
      { ...feedbackInput, needsHumanSupport: true }, employee
    );
    await service.updateFeedbackStatus(record.id, 'resolved', maintainer);

    const summary = await service.getFeedbackSummary('public-skill', maintainer);
    expect(summary.needsHumanSupport).toBe(1);
    expect(summary.openNeedsHumanSupport).toBe(0);
  });

  it('rejects status changes from non-maintainers', async () => {
    const service = createService();
    const record = await service.submitFeedback(feedbackInput, employee);

    await expect(
      service.updateFeedbackStatus(record.id, 'resolved', employee)
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});

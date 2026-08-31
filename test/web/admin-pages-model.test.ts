// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import {
  buildAuditLogsPath,
  buildEmergencyDisablePayload,
  buildReviewerAssignmentPayload,
  buildReviewerPath,
  buildVersionGovernancePath,
  buildVersionDelistPayload
} from '../../web/src/api/admin.js';
import { buildScriptRequestBody } from '../../web/src/api/catalog.js';
import {
  filterMyInstallations,
  governancePackageOptions,
  installationTargetPath,
  reviewerCandidateOptions,
  reviewerScopeCategories
} from '../../web/src/pages/admin-model.js';
import type { MyInstallation } from '../../web/src/api/types.js';

describe('Task 9.7 管理頁與我的安裝模型', () => {
  it('版本治理選單使用 Catalog 的真實 packageId，不把版本號或列表序號當成 ID', () => {
    expect(
      governancePackageOptions([
        {
          packageId: 'mysql-mcp',
          name: 'MySQL MCP',
          ownerTeam: '資料庫平台'
        },
        {
          packageId: 'deploy-runner',
          name: 'Deploy Runner',
          ownerTeam: 'SRE'
        }
      ])
    ).toEqual([
      {
        value: 'mysql-mcp',
        label: 'MySQL MCP · mysql-mcp · 資料庫平台'
      },
      {
        value: 'deploy-runner',
        label: 'Deploy Runner · deploy-runner · SRE'
      }
    ]);
  });

  it('審核者選單顯示姓名、UID 與團隊，提交值只使用真實 UID', () => {
    expect(
      reviewerCandidateOptions([
        { uid: 'reviewer-dba', displayName: '資料庫審核員', teamIds: ['DBA'] }
      ])
    ).toEqual([
      {
        value: 'reviewer-dba',
        label: '資料庫審核員 · reviewer-dba · DBA'
      }
    ]);
  });

  it('分類選項依 Catalog 真實套件類型聯動並去重', () => {
    const scopes = [
      { type: 'skill' as const, category: '通用' },
      { type: 'tool' as const, category: 'DBA' },
      { type: 'skill' as const, category: '後端' },
      { type: 'skill' as const, category: '通用' }
    ];

    expect(reviewerScopeCategories(scopes, 'skill')).toEqual(['後端', '通用']);
    expect(reviewerScopeCategories(scopes, 'tool')).toEqual(['DBA']);
  });

  it('審核者新增只提交後端允許的三個範圍欄位', () => {
    expect(
      buildReviewerAssignmentPayload({
        reviewerUid: ' reviewer-1 ',
        packageType: ' skill ',
        category: ' developer-tools '
      })
    ).toEqual({
      reviewerUid: 'reviewer-1',
      packageType: 'skill',
      category: 'developer-tools'
    });
  });

  it('審核者撤銷路徑編碼 assignment id，避免路徑字元改變 API 目標', () => {
    expect(buildReviewerPath('assignment /一')).toBe(
      '/api/admin/reviewers/assignment%20%2F%E4%B8%80'
    );
  });

  it('稽核查詢只送出真實 filters、cursor 與固定頁長', () => {
    expect(
      buildAuditLogsPath({
        eventType: 'review.approved',
        actorUid: ' admin-1 ',
        targetType: 'version',
        targetId: 'pkg-1@1.0.0',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-28T23:59:59.999Z',
        cursor: 'opaque cursor'
      })
    ).toBe(
      '/api/audit/logs?eventType=review.approved&actorUid=admin-1&targetType=version&targetId=pkg-1%401.0.0&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-28T23%3A59%3A59.999Z&cursor=opaque+cursor&limit=50'
    );
  });

  it('版本治理只產生立即撤下 payload，不接受未來排程輸入', () => {
    expect(
      buildVersionDelistPayload(
        { reasonCode: ' policy_change ', reasonDetail: ' 已由新版取代 ' },
        new Date('2026-08-28T10:30:00.000Z')
      )
    ).toEqual({
      reasonCode: 'policy_change',
      reasonDetail: '已由新版取代',
      effectiveAt: '2026-08-28T10:30:00.000Z'
    });
    expect(
      buildEmergencyDisablePayload({
        reasonCode: ' critical_issue ',
        reasonDetail: ' 立即阻擋 '
      })
    ).toEqual({ reasonCode: 'critical_issue', reasonDetail: '立即阻擋' });
    expect(buildVersionGovernancePath('pkg /一', '1.0 beta', 'delist')).toBe(
      '/api/packages/pkg%20%2F%E4%B8%80/versions/1.0%20beta/delist'
    );
  });

  it('腳本請求明確傳遞 install 或 uninstall action', () => {
    expect(
      buildScriptRequestBody(
        { targetOs: 'windows', clientRuntime: 'Codex' },
        'uninstall'
      )
    ).toEqual({
      targetOs: 'windows',
      clientRuntime: 'Codex',
      action: 'uninstall'
    });
  });

  it('我的安裝只依真實 upgradeAvailable 欄位篩選', () => {
    const installations: MyInstallation[] = [
      {
        packageId: 'pkg-a',
        packageName: 'Alpha',
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
        status: 'installed',
        upgradeAvailable: true
      },
      {
        packageId: 'pkg-b',
        packageName: 'Beta',
        currentVersion: '2.0.0',
        availableVersion: '2.0.0',
        status: 'installed',
        upgradeAvailable: false
      }
    ];

    expect(filterMyInstallations(installations, 'upgrade')).toEqual([
      installations[0]
    ]);
    expect(filterMyInstallations(installations, 'current')).toEqual([
      installations[1]
    ]);
  });

  it('卸載先回套件詳情選目標，只傳遞 intent 而不推測 OS 或 Client', () => {
    expect(installationTargetPath('pkg /一', 'uninstall')).toBe(
      '/packages/pkg%20%2F%E4%B8%80?intent=uninstall'
    );
  });
});

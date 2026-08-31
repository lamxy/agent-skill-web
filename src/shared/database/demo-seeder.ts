// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

/**
 * 開發用示範資料的單一實作來源。
 *
 * 兩個呼叫端共用本檔，避免同一份資料維護兩次：
 *   scripts/seed-demo-data.ts  宿主機開發（npm run db:seed，走 tsx）
 *   src/seed.ts                容器內（node dist/seed.js，compose.stack.yaml 使用）
 *
 * 僅供本機預覽頁面效果，不在測試或生產使用。
 */
import { Client } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform';

interface DemoVersion {
  version: string;
  supportedOs: string[];
  clients: string[];
  lifecycle: 'published' | 'review_required' | 'deprecated';
  installCommand: string;
  uninstallCommand: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
}

interface DemoPackage {
  packageId: string;
  type: 'skill' | 'tool';
  name: string;
  purpose: string;
  ownerTeam: string;
  /** legacy 自由文字分類，只作顯示；篩選走 categoryCode */
  category: string;
  categoryCode:
    | 'frontend' | 'backend' | 'data' | 'testing'
    | 'devops' | 'security' | 'product_design' | 'general';
  source: 'opensource' | 'custom';
  publisherKind: 'individual' | 'organization';
  publisherName: string;
  grade: 'basic' | 'premium' | 'general' | 'company_wide' | 'open_sourced';
  sourceUri: string;
  license: string;
  versions: DemoVersion[];
  /** 產生的安裝事實筆數，用來讓採用數據有內容 */
  installations?: { succeeded: number; failed: number };
}

const PACKAGES: DemoPackage[] = [
  {
    packageId: 'superpowers',
    type: 'skill',
    name: 'superpowers',
    purpose:
      '提供工作樹隔離、規格驅動開發與測試驅動開發的完整工作流，讓多個任務能在互不干擾的分支上並行推進。',
    ownerTeam: '公共架構技術賦能',
    category: '通用',
    categoryCode: 'general',
    source: 'opensource',
    publisherKind: 'organization',
    publisherName: '公共架構',
    grade: 'company_wide',
    sourceUri: 'https://git.internal/platform/superpowers',
    license: 'MIT',
    installations: { succeeded: 145, failed: 41 },
    versions: [
      {
        version: '3.2.1',
        supportedOs: ['linux', 'macos'],
        clients: ['Claude Code', 'Codex'],
        lifecycle: 'published',
        installCommand:
          'set -euo pipefail\nSKILL_HOME="${HOME}/.superpowers"\nmkdir -p "${SKILL_HOME}/worktrees"\necho "superpowers 已就緒"',
        uninstallCommand:
          'set -euo pipefail\nrm -rf "${HOME}/.superpowers/worktrees"',
        hasResidualEffects: true,
        residualDescription: '設定檔保留於 ~/.superpowers/config，供重新安裝時沿用。',
        manualCleanupSteps: 'rm -rf ~/.superpowers'
      },
      {
        version: '3.2.0',
        supportedOs: ['linux'],
        clients: ['Claude Code'],
        lifecycle: 'deprecated',
        installCommand: 'set -euo pipefail\nmkdir -p "${HOME}/.superpowers"',
        uninstallCommand: 'rm -rf "${HOME}/.superpowers"',
        hasResidualEffects: false
      }
    ]
  },
  {
    packageId: 'mysql-mcp',
    type: 'tool',
    name: 'mysql-mcp',
    purpose: '只讀排障與 Schema 分析，不開放任何寫入操作。',
    ownerTeam: '資料庫平台',
    category: 'DBA',
    categoryCode: 'data',
    source: 'opensource',
    publisherKind: 'organization',
    publisherName: '資料庫平台',
    grade: 'premium',
    sourceUri: 'https://git.internal/dba/mysql-mcp',
    license: 'Apache-2.0',
    installations: { succeeded: 44, failed: 20 },
    versions: [
      {
        version: '1.4.0',
        supportedOs: ['linux', 'macos'],
        clients: ['Claude Code'],
        lifecycle: 'published',
        installCommand:
          'set -euo pipefail\nnpm i -g @internal/mysql-mcp@1.4.0',
        uninstallCommand: 'npm uninstall -g @internal/mysql-mcp',
        hasResidualEffects: false
      }
    ]
  },
  {
    packageId: 'pm-skill',
    type: 'skill',
    name: 'pm-skill',
    purpose: '需求拆解與驗收標準生成，輸出可直接進入排程的工作項。',
    ownerTeam: '產品效能',
    category: '產品',
    categoryCode: 'product_design',
    source: 'custom',
    publisherKind: 'individual',
    publisherName: '張三',
    grade: 'premium',
    sourceUri: 'https://git.internal/product/pm-skill',
    license: 'MIT',
    installations: { succeeded: 39, failed: 4 },
    versions: [
      {
        version: '0.8.3',
        supportedOs: ['linux', 'macos', 'windows'],
        clients: ['Claude Code', 'Codex'],
        lifecycle: 'published',
        installCommand: 'set -euo pipefail\nmkdir -p "${HOME}/.pm-skill"',
        uninstallCommand: 'rm -rf "${HOME}/.pm-skill"',
        hasResidualEffects: false
      }
    ]
  },
  {
    packageId: 'deploy-runner',
    type: 'tool',
    name: 'deploy-runner',
    purpose: '灰度部署與回滾編排，需要 DBA 與 SRE 雙簽後才可執行。',
    ownerTeam: 'SRE',
    category: '部署',
    categoryCode: 'devops',
    source: 'custom',
    publisherKind: 'organization',
    publisherName: 'SRE',
    grade: 'basic',
    sourceUri: 'https://git.internal/sre/deploy-runner',
    license: 'Proprietary',
    versions: [
      {
        version: '2.0.0-rc.1',
        supportedOs: ['linux'],
        clients: ['Codex'],
        lifecycle: 'review_required',
        installCommand: 'set -euo pipefail\ninstall -d /etc/deploy-runner',
        uninstallCommand: 'rm -rf /etc/deploy-runner',
        hasResidualEffects: true,
        residualDescription: '寫入 /etc/deploy-runner 與 systemd unit。',
        manualCleanupSteps: 'systemctl disable deploy-runner && rm -rf /etc/deploy-runner'
      }
    ]
  },
  {
    packageId: 'trace-lens',
    type: 'skill',
    name: 'trace-lens',
    purpose: '分散式追蹤取樣與熱點歸因，聚焦跨服務延遲來源。',
    ownerTeam: '可觀測性',
    category: '後端',
    categoryCode: 'backend',
    source: 'opensource',
    publisherKind: 'individual',
    publisherName: '李四',
    grade: 'open_sourced',
    sourceUri: 'https://git.internal/o11y/trace-lens',
    license: 'MIT',
    installations: { succeeded: 19, failed: 8 },
    versions: [
      {
        version: '1.1.2',
        supportedOs: ['linux', 'macos'],
        clients: ['Claude Code'],
        lifecycle: 'published',
        installCommand: 'set -euo pipefail\nmkdir -p "${HOME}/.trace-lens"',
        uninstallCommand: 'rm -rf "${HOME}/.trace-lens"',
        hasResidualEffects: false
      }
    ]
  }
];

export async function seedDemoData(): Promise<void> {
  const database = new Client({ connectionString: DATABASE_URL });
  await database.connect();

  try {
    for (const pkg of PACKAGES) {
      await database.query(
        `insert into packages
           (package_id, type, name, purpose, owner_team, category, category_code,
            visibility, source_uri, license, source, publisher_kind, publisher_name,
            grade, grade_decided_by_uid, grade_decided_at, lifecycle)
         values ($1, $2, $3, $4, $5, $6, $7, 'public', $8, $9, $10, $11, $12,
                 $13, 'dev-admin', now(), 'active')
         on conflict (package_id) do nothing`,
        [
          pkg.packageId,
          pkg.type,
          pkg.name,
          pkg.purpose,
          pkg.ownerTeam,
          pkg.category,
          pkg.categoryCode,
          pkg.sourceUri,
          pkg.license,
          pkg.source,
          pkg.publisherKind,
          pkg.publisherName,
          pkg.grade
        ]
      );

      for (const version of pkg.versions) {
        await database.query(
          `insert into package_versions
             (package_id, version, supported_os, supported_clients, lifecycle,
              install_command, uninstall_command, has_residual_effects,
              residual_description, manual_cleanup_steps, author_uid)
           values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10, 'dev-admin')
           on conflict (package_id, version) do nothing`,
          [
            pkg.packageId,
            version.version,
            JSON.stringify(version.supportedOs),
            JSON.stringify(
              version.clients.map((name) => ({
                name,
                adaptationSource: 'publisher',
                maintainer: pkg.ownerTeam
              }))
            ),
            version.lifecycle,
            version.installCommand,
            version.uninstallCommand,
            version.hasResidualEffects,
            version.residualDescription ?? null,
            version.manualCleanupSteps ?? null
          ]
        );
      }

      if (!pkg.installations) continue;

      const published = pkg.versions.find(
        (version) => version.lifecycle === 'published'
      );
      if (!published) continue;

      const total = pkg.installations.succeeded + pkg.installations.failed;
      for (let index = 0; index < total; index += 1) {
        const succeeded = index < pkg.installations.succeeded;
        await database.query(
          `insert into installations
             (idempotency_key, package_id, version, user_ref, user_ref_type,
              os_type, client_runtime, status, error_code,
              started_at, ended_at, payload_fingerprint)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                   now(), now(), 'demo-seed')
           on conflict do nothing`,
          [
            `demo-${pkg.packageId}-${index}`,
            pkg.packageId,
            published.version,
            index % 3 === 0 ? `uuid-demo-${index}` : `emp-${index % 40}`,
            index % 3 === 0 ? 'uuid' : 'uid',
            index % 2 === 0 ? 'linux' : 'macos',
            published.clients[0] ?? 'Claude Code',
            succeeded ? 'succeeded' : 'failed',
            succeeded ? null : 'DEPENDENCY_CONFLICT'
          ]
        );
      }
    }

    console.log('示範資料已寫入');
  } finally {
    await database.end();
  }
}

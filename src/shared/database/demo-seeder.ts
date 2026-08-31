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
import { createHash } from 'node:crypto';

import { Client } from 'pg';

import { createInitialRevision } from '../../modules/catalog/script-target-model.js';
import type { ClientRuntime, ScriptTargetOs } from '../../modules/catalog/types.js';

/**
 * package_versions 的 supportedOs 與腳本目標的 target_os 取值不同：
 * 前者是 linux／macos／windows，後者是 linux/macos／windows／wsl
 * （腳本層面 linux 與 macos 共用同一份 shell 腳本，故合為一個目標）。
 */
const TARGET_OS_BY_SUPPORTED_OS: Record<string, ScriptTargetOs> = {
  linux: 'linux/macos',
  macos: 'linux/macos',
  windows: 'windows'
};

/** 顯示名稱 → clientRuntime。前端送出的是後者，API 只接受後者。 */
const CLIENT_RUNTIME_BY_NAME: Record<string, ClientRuntime> = {
  'Claude Code': 'claude-code',
  Codex: 'codex'
};

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
  /**
   * 產生一筆機器驗證通過的記錄，讓演示環境同時具備兩種審核樣態：
   * 未經機器驗證（VALIDATION_MODE=manual 的預設情況）與已通過機器驗證。
   * 否則審核工作台的驗證矩陣永遠沒有資料可呈現。
   */
  machineValidated?: boolean;
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
        manualCleanupSteps: 'systemctl disable deploy-runner && rm -rf /etc/deploy-runner',
        // 唯一一筆已通過機器驗證的示範資料，用來呈現驗證矩陣的完整樣態。
        machineValidated: true
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

interface SeededTarget {
  targetId: string;
  targetOs: ScriptTargetOs;
  clientRuntime: ClientRuntime;
  contentDigest: string;
  scriptVersion: number;
}

/**
 * 寫入一筆「機器驗證通過」的執行記錄。
 *
 * 演示環境預設 VALIDATION_MODE=manual，所有送審都是 skipped，
 * 審核工作台的驗證矩陣因此永遠沒有資料。這裡補一筆通過的記錄，
 * 讓演示能同時展示兩種樣態。
 *
 * digest 全部沿用實際寫入的修訂版，與正式流程產生的資料同構；
 * 若捏造數值，審核頁的摘要比對會判定為不一致。
 */
async function seedPassedValidationRun(
  database: Client,
  pkg: DemoPackage,
  version: DemoVersion,
  targets: readonly SeededTarget[]
): Promise<void> {
  // 演示資料的時間軸：驗證發生在「現在」之前，讀起來才像真的跑過。
  const startedAt = new Date(Date.now() - 6 * 60 * 1000);
  const endedAt = new Date(startedAt.getTime() + 47_000);
  const runnerName = 'docker-linux';
  const runnerVersion = `${runnerName}/node:22-bookworm-slim`;
  const registryVersion = 'validation-runner-registry/1.1.0';
  const scriptDigest = `sha256:${createHash('sha256')
    .update(targets.map((target) => target.contentDigest).join('|'))
    .digest('hex')}`;

  const expectedMatrix = targets.map((target) => ({
    os: target.targetOs,
    client: target.clientRuntime,
    targetId: target.targetId,
    contentDigest: target.contentDigest,
    scriptVersion: target.scriptVersion
  }));

  const matrixResults = targets.map((target) => ({
    os: target.targetOs,
    client: target.clientRuntime,
    targetId: target.targetId,
    runnerName,
    runnerVersion,
    scriptDigest,
    contentDigest: target.contentDigest,
    scriptVersion: target.scriptVersion,
    installScriptDigest: scriptDigest,
    uninstallScriptDigest: scriptDigest,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    installExitCode: 0,
    telemetrySeen: true,
    uninstallExitCode: 0,
    cleanupSucceeded: true,
    status: 'passed'
  }));

  const attempts = [
    {
      kind: 'initial',
      attempt: 1,
      status: 'passed',
      requestedByUid: 'dev-admin',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      runnerVersion: registryVersion,
      matrixResults
    }
  ];

  const runRows = await database.query<{ id: string }>(
    `insert into validation_runs
       (package_id, version, script_digest, status, requested_by_uid,
        expected_matrix, attempts, last_attempt_started_at, runner_version,
        matrix_results, started_at, ended_at, contract_version,
        target_snapshots, manifest_digest)
     values ($1, $2, $3, 'passed', 'dev-admin', $4::jsonb, $5::jsonb, $6, $7,
             $8::jsonb, $6, $9, 2, $10::jsonb, $3)
     on conflict do nothing
     returning id`,
    [
      pkg.packageId,
      version.version,
      scriptDigest,
      JSON.stringify(expectedMatrix),
      JSON.stringify(attempts),
      startedAt,
      registryVersion,
      JSON.stringify(matrixResults),
      endedAt,
      JSON.stringify(
        targets.map((target) => ({
          targetId: target.targetId,
          targetOs: target.targetOs,
          clientRuntime: target.clientRuntime,
          contentDigest: target.contentDigest,
          scriptVersion: target.scriptVersion,
          installCommand: version.installCommand,
          uninstallCommand: version.uninstallCommand,
          usageInstructions: `安裝後即可使用 ${pkg.name}。`,
          options: [],
          hasResidualEffects: version.hasResidualEffects
        }))
      )
    ]
  );

  // 驗證通過後平台會建立待審核記錄；缺這筆，審核工作台開不出這個版本。
  //
  // author_uid 用 dev-admin（與 package_versions 的作者一致）而非 mock 帳號：
  // 伺服器強制送審者不得審自己的版本，若填成 mock-reviewer，
  // 該審核者就永遠看不到這筆演示資料。
  const validationRunId = runRows.rows[0]?.id;
  if (!validationRunId) return;

  // 快照必須是應用層的 camelCase 形狀（mapVersionSnapshot 直接讀
  // supportedOs、scriptTargets 等欄位），不能用 to_jsonb 取資料庫原始列，
  // 那會得到 snake_case 而在讀取時拋 TypeError。
  const now = new Date();
  const packageSnapshot = {
    packageId: pkg.packageId,
    type: pkg.type,
    name: pkg.name,
    purpose: pkg.purpose,
    ownerTeam: pkg.ownerTeam,
    category: pkg.category,
    categoryCode: pkg.categoryCode,
    visibility: 'public',
    sourceUri: pkg.sourceUri,
    license: pkg.license,
    source: pkg.source,
    publisherKind: pkg.publisherKind,
    publisherName: pkg.publisherName,
    grade: pkg.grade,
    gradeDecidedByUid: 'dev-admin',
    gradeDecidedAt: now.toISOString(),
    lifecycle: 'active',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const versionSnapshot = {
    packageId: pkg.packageId,
    version: version.version,
    supportedOs: version.supportedOs,
    supportedClients: version.clients.map((name) => ({
      name,
      adaptationSource: 'publisher',
      maintainer: pkg.ownerTeam
    })),
    lifecycle: version.lifecycle,
    installCommand: version.installCommand,
    uninstallCommand: version.uninstallCommand,
    hasResidualEffects: version.hasResidualEffects,
    ...(version.residualDescription
      ? { residualDescription: version.residualDescription }
      : {}),
    ...(version.manualCleanupSteps
      ? { manualCleanupSteps: version.manualCleanupSteps }
      : {}),
    authorUid: 'dev-admin',
    scriptTargets: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  await database.query(
    `insert into publication_reviews
       (package_id, version, package_type, category, owner_team, author_uid,
        validation_run_id, package_snapshot, version_snapshot, status)
     values ($1, $2, $3, $4, $5, 'dev-admin', $6, $7::jsonb, $8::jsonb, 'pending')
     on conflict do nothing`,
    [
      pkg.packageId,
      version.version,
      pkg.type,
      pkg.category,
      pkg.ownerTeam,
      validationRunId,
      JSON.stringify(packageSnapshot),
      JSON.stringify(versionSnapshot)
    ]
  );
}

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

        // 腳本目標與其首個修訂版。缺這兩張表時 API 回傳的 supportedClients
        // 沒有 clientRuntime，技能詳情頁的「檢視並下載安裝腳本」會恆為 disabled。
        // 修訂版透過 createInitialRevision 建立，與 API 走同一套內容驗證與
        // content_digest 計算，避免示範資料與正式流程產生的資料不一致。
        const targetOsList = [
          ...new Set(
            version.supportedOs
              .map((os) => TARGET_OS_BY_SUPPORTED_OS[os])
              .filter((os): os is ScriptTargetOs => Boolean(os))
          )
        ];
        // 供 machineValidated 版本組出 expectedMatrix 與 matrixResults，
        // digest 一律沿用實際寫入的修訂版，不另行捏造。
        const seededTargets: Array<{
          targetId: string;
          targetOs: ScriptTargetOs;
          clientRuntime: ClientRuntime;
          contentDigest: string;
          scriptVersion: number;
        }> = [];

        for (const targetOs of targetOsList) {
          for (const clientName of version.clients) {
            const clientRuntime = CLIENT_RUNTIME_BY_NAME[clientName];
            if (!clientRuntime) continue;

            // id 由內容決定而非隨機，重複執行 seed 時不會產生重複目標。
            const targetId = `demo-${pkg.packageId}-${version.version}-${targetOs.replace('/', '-')}-${clientRuntime}`;
            const revision = createInitialRevision(
              { id: targetId, targetOs, clientRuntime },
              {
                installCommand: version.installCommand,
                uninstallCommand: version.uninstallCommand,
                usageInstructions: `安裝後即可在 ${clientName} 中使用 ${pkg.name}。`,
                options: [],
                ...(version.hasResidualEffects
                  ? {
                      hasResidualEffects: true,
                      residualDescription: version.residualDescription ?? '',
                      manualCleanupSteps: version.manualCleanupSteps ?? ''
                    }
                  : { hasResidualEffects: false })
              },
              'dev-admin',
              new Date()
            );

            await database.query(
              `insert into package_version_script_targets
                 (id, package_id, package_version, target_os, client_runtime,
                  current_revision_id)
               values ($1, $2, $3, $4, $5, $6)
               on conflict (package_id, package_version, target_os, client_runtime)
                 do nothing`,
              [
                targetId,
                pkg.packageId,
                version.version,
                targetOs,
                clientRuntime,
                revision.id
              ]
            );

            await database.query(
              `insert into script_target_revisions
                 (id, target_id, target_os, client_runtime, script_version,
                  install_command, uninstall_command, options, usage_instructions,
                  has_residual_effects, residual_description, manual_cleanup_steps,
                  content_digest, created_by_uid)
               values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12,
                       $13, $14)
               on conflict (target_id, script_version) do nothing`,
              [
                revision.id,
                targetId,
                targetOs,
                clientRuntime,
                revision.scriptVersion,
                revision.installCommand,
                revision.uninstallCommand,
                JSON.stringify(revision.options),
                revision.usageInstructions,
                revision.hasResidualEffects,
                revision.residualDescription ?? null,
                revision.manualCleanupSteps ?? null,
                revision.contentDigest,
                revision.createdByUid
              ]
            );

            seededTargets.push({
              targetId,
              targetOs,
              clientRuntime,
              contentDigest: revision.contentDigest,
              scriptVersion: revision.scriptVersion
            });
          }
        }

        if (version.machineValidated && seededTargets.length > 0) {
          await seedPassedValidationRun(database, pkg, version, seededTargets);
        }
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

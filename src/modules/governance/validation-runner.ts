// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { CatalogAggregate, PackageVersionRecord } from '../catalog/types.js';
import type { ValidationTargetSnapshot } from './script-target-governance.js';

export type ValidationMatrixStatus = 'passed' | 'failed' | 'not_supported';

export interface ValidationMatrixTarget {
  os: string;
  client: string;
  targetId?: string;
  scriptVersion?: number;
  contentDigest?: string;
}

/** Client 名稱以 Unicode NFKC、小寫與 kebab-case 分隔符形成比較鍵。 */
export function normalizeClientName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '-');
}

/** OS 名稱使用與 client 相同的正規化，避免 adapter 大小寫造成重複矩陣。 */
export function normalizeOsName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export interface ValidationMatrixResult {
  os: string;
  client: string;
  runnerName: string;
  runnerVersion: string;
  scriptDigest: string;
  targetId?: string;
  scriptVersion?: number;
  contentDigest?: string;
  installScriptDigest?: string;
  uninstallScriptDigest?: string;
  startedAt: Date;
  endedAt: Date;
  installExitCode?: number;
  telemetrySeen?: boolean;
  uninstallExitCode?: number;
  cleanupSucceeded: boolean;
  status: ValidationMatrixStatus;
  errorCode?: string;
}

export interface ValidationRunnerInput {
  validationRunId: string;
  package: CatalogAggregate['package'];
  version: PackageVersionRecord;
  requestedByUid: string;
  expectedMatrix: ValidationMatrixTarget[];
  targetSnapshots: ValidationTargetSnapshot[];
}

export interface ValidationRunResult {
  /**
   * skipped 代表機器驗證未執行（VALIDATION_MODE=manual），與 passed 語意不同：
   * 前者沒有跑過任何驗證，後者是實跑並通過。兩者若混用，審核者會誤以為
   * 腳本已通過自動檢查。
   */
  status: 'passed' | 'failed' | 'skipped';
  runnerVersion: string;
  matrixResults: ValidationMatrixResult[];
  errorCode?: string;
}

export interface ValidationRunner {
  run(input: ValidationRunnerInput): Promise<ValidationRunResult>;
}

/** VALIDATION_MODE=manual 時的 runnerVersion，供前端辨識「未經機器驗證」。 */
export const SKIPPED_RUNNER_VERSION = 'manual-review/skipped';

/**
 * 人工審核模式的 runner：不執行任何驗證，直接回報 skipped。
 *
 * 機器驗證需要應用能呼叫宿主機 docker，容器化部署不具備該能力；
 * 此時改由審核者自行下載腳本到真實環境確認。
 */
export class SkippedValidationRunner implements ValidationRunner {
  async run(): Promise<ValidationRunResult> {
    return {
      status: 'skipped',
      runnerVersion: SKIPPED_RUNNER_VERSION,
      matrixResults: []
    };
  }
}

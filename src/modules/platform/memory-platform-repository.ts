// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { PlatformRepository } from './repository.js';
import type { PlatformVersionRecord } from './types.js';

/**
 * 預設版本清單。與 drizzle/0016_platform_versions.sql 的初始資料一致，
 * 讓不接資料庫的開發與測試環境看到的版本選單與正式環境相同。
 */
const DEFAULT_VERSIONS: PlatformVersionRecord[] = [
  {
    version: 'v1.0.0',
    isAvailable: false,
    isCurrent: false,
    note: '規劃中，暫未開放。',
    releasedAt: null,
    displayOrder: 20
  },
  {
    version: 'v0.0.1',
    isAvailable: true,
    isCurrent: true,
    note: '目前運行中的版本。',
    releasedAt: null,
    displayOrder: 10
  }
];

export class MemoryPlatformRepository implements PlatformRepository {
  private readonly versions: PlatformVersionRecord[];

  constructor(versions: PlatformVersionRecord[] = DEFAULT_VERSIONS) {
    this.versions = [...versions].sort(
      (left, right) =>
        right.displayOrder - left.displayOrder ||
        left.version.localeCompare(right.version)
    );
  }

  async listVersions(): Promise<PlatformVersionRecord[]> {
    return this.versions.map((version) => ({ ...version }));
  }

  async findVersion(version: string): Promise<PlatformVersionRecord | undefined> {
    const found = this.versions.find((item) => item.version === version);
    return found ? { ...found } : undefined;
  }
}

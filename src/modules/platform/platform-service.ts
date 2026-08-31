// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { PlatformRepository } from './repository.js';
import type { PlatformVersionRecord } from './types.js';
import { AppError } from '../../shared/errors/app-error.js';

/** 前端點選版本後要顯示在提示彈框裡的內容 */
export interface PlatformVersionAvailability {
  version: string;
  isAvailable: boolean;
  /** 直接可顯示的訊息，開放與否的措辭統一由後端決定 */
  message: string;
  note: string | null;
  releasedAt: string | null;
}

export class PlatformService {
  constructor(private readonly repository: PlatformRepository) {}

  async listVersions(): Promise<{
    versions: PlatformVersionRecord[];
    currentVersion: string | null;
  }> {
    const versions = await this.repository.listVersions();
    /* 沒有任何一筆標為預設時退回第一個開放的版本，避免選單開在空值上 */
    const current =
      versions.find((version) => version.isCurrent) ??
      versions.find((version) => version.isAvailable);
    return { versions, currentVersion: current?.version ?? null };
  }

  async checkAvailability(version: string): Promise<PlatformVersionAvailability> {
    const record = await this.repository.findVersion(version);
    if (!record) {
      throw new AppError({
        statusCode: 404,
        code: 'PLATFORM_VERSION_NOT_FOUND',
        message: `找不到平台版本 ${version}。`
      });
    }

    return {
      version: record.version,
      isAvailable: record.isAvailable,
      message: record.isAvailable
        ? `${record.version} 已開放使用。`
        : `${record.version} 暫未開放。`,
      note: record.note,
      releasedAt: record.releasedAt
    };
  }
}

// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { PlatformVersionRecord } from './types.js';

export interface PlatformRepository {
  /** 依顯示順序列出全部平台版本，新版本在前 */
  listVersions(): Promise<PlatformVersionRecord[]>;
  /** 查單一版本；不存在時回傳 undefined，由呼叫端決定如何回應 */
  findVersion(version: string): Promise<PlatformVersionRecord | undefined>;
}

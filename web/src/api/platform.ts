// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type {
  PlatformVersionAvailability,
  PlatformVersionList
} from './types.js';

export async function fetchPlatformVersions(
  signal: AbortSignal
): Promise<PlatformVersionList> {
  return request<PlatformVersionList>('/api/platform/versions', { signal });
}

export async function checkPlatformVersion(
  version: string
): Promise<PlatformVersionAvailability> {
  return request<PlatformVersionAvailability>(
    `/api/platform/versions/${encodeURIComponent(version)}`
  );
}

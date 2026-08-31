// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type { MyInstallation } from './types.js';

export async function fetchMyInstallations(
  signal: AbortSignal
): Promise<MyInstallation[]> {
  return request<MyInstallation[]>('/api/me/installations', { signal });
}

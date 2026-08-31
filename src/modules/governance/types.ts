// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { VersionLifecycle } from '../catalog/types.js';

export type { VersionLifecycle } from '../catalog/types.js';

export type VersionEvent =
  | 'SUBMIT'
  | 'VALIDATION_PASSED'
  | 'VALIDATION_FAILED'
  | 'APPROVE'
  | 'REJECT'
  | 'REVISE'
  | 'DEPRECATE'
  | 'DELIST'
  | 'EMERGENCY_DISABLE';

export type VersionTransitionTable = Readonly<
  Record<VersionLifecycle, Partial<Record<VersionEvent, VersionLifecycle>>>
>;

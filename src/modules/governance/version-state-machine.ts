// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { AppError } from '../../shared/errors/app-error.js';
import type { VersionEvent, VersionLifecycle, VersionTransitionTable } from './types.js';

const transitions: VersionTransitionTable = {
  draft: { SUBMIT: 'validating' },
  validating: {
    VALIDATION_PASSED: 'review_required',
    VALIDATION_FAILED: 'draft',
  },
  validation_failed: {},
  review_required: {
    APPROVE: 'published',
    REJECT: 'draft',
    REVISE: 'draft',
  },
  published: {
    REVISE: 'draft',
    DEPRECATE: 'deprecated',
    DELIST: 'delisted',
    EMERGENCY_DISABLE: 'emergency_disabled',
  },
  deprecated: {
    DELIST: 'delisted',
    EMERGENCY_DISABLE: 'emergency_disabled',
  },
  delisted: { EMERGENCY_DISABLE: 'emergency_disabled' },
  emergency_disabled: {},
};

export function canTransitionVersion(current: VersionLifecycle, event: VersionEvent): boolean {
  return transitions[current][event] !== undefined;
}

export function transitionVersion(current: VersionLifecycle, event: VersionEvent): VersionLifecycle {
  const next = transitions[current][event];
  if (next === undefined) {
    throw new AppError({
      statusCode: 409,
      code: 'INVALID_VERSION_TRANSITION',
      message: `版本狀態 ${current} 不允許事件 ${event}`,
    });
  }
  return next;
}

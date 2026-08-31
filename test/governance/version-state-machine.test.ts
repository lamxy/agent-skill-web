// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';
import { canTransitionVersion, transitionVersion } from '../../src/modules/governance/version-state-machine.js';
import type { VersionEvent } from '../../src/modules/governance/types.js';
import type { VersionLifecycle } from '../../src/modules/catalog/types.js';

describe('版本生命週期狀態機', () => {
  it.each([
    ['draft', 'SUBMIT', 'validating'],
    ['validating', 'VALIDATION_PASSED', 'review_required'],
    ['validating', 'VALIDATION_FAILED', 'draft'],
    ['review_required', 'APPROVE', 'published'],
    ['review_required', 'REJECT', 'draft'],
    ['review_required', 'REVISE', 'draft'],
    ['published', 'REVISE', 'draft'],
    ['published', 'DEPRECATE', 'deprecated'],
    ['published', 'DELIST', 'delisted'],
    ['published', 'EMERGENCY_DISABLE', 'emergency_disabled'],
    ['deprecated', 'DELIST', 'delisted'],
    ['deprecated', 'EMERGENCY_DISABLE', 'emergency_disabled'],
    ['delisted', 'EMERGENCY_DISABLE', 'emergency_disabled'],
  ] as const)('%s + %s -> %s', (current, event, expected) => {
    expect(transitionVersion(current, event)).toBe(expected);
    expect(canTransitionVersion(current, event)).toBe(true);
  });

  it.each([
    ['draft', 'APPROVE'],
    ['published', 'SUBMIT'],
    ['emergency_disabled', 'DELIST'],
  ] as const)('%s + %s 拒絕非法轉換', (current, event) => {
    expect(canTransitionVersion(current, event)).toBe(false);
    expect(() => transitionVersion(current, event)).toThrowError(
      expect.objectContaining({ code: 'INVALID_VERSION_TRANSITION', statusCode: 409 }),
    );
  });

  it('拒絕所有未列出的轉換', () => {
    const states: VersionLifecycle[] = [
      'draft', 'validating', 'validation_failed', 'review_required', 'published',
      'deprecated', 'delisted', 'emergency_disabled',
    ];
    const events: VersionEvent[] = [
      'SUBMIT', 'VALIDATION_PASSED', 'VALIDATION_FAILED', 'APPROVE', 'REJECT',
      'REVISE', 'DEPRECATE', 'DELIST', 'EMERGENCY_DISABLE',
    ];
    for (const state of states) {
      for (const event of events) {
        if (!canTransitionVersion(state, event)) {
          expect(() => transitionVersion(state, event)).toThrowError(
            expect.objectContaining({ code: 'INVALID_VERSION_TRANSITION' }),
          );
        }
      }
    }
  });
});

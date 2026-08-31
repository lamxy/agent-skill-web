// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';
import { MemoryPlatformRepository } from '../../src/modules/platform/memory-platform-repository.js';
import { PlatformService } from '../../src/modules/platform/platform-service.js';

describe('PlatformService', () => {
  const service = new PlatformService(new MemoryPlatformRepository());

  it('列出版本並標出預設版本', async () => {
    const { versions, currentVersion } = await service.listVersions();
    expect(versions.map((v) => v.version)).toEqual(['v1.0.0', 'v0.0.1']);
    expect(currentVersion).toBe('v0.0.1');
  });

  it('未開放版本回傳暫未開放訊息', async () => {
    expect((await service.checkAvailability('v1.0.0')).message).toContain('暫未開放');
    expect((await service.checkAvailability('v0.0.1')).message).toContain('已開放');
  });

  it('不存在的版本回 404', async () => {
    await expect(service.checkAvailability('v9.9.9')).rejects.toMatchObject({ statusCode: 404 });
  });
});

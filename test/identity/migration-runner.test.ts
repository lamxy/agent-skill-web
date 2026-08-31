// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverMigrations } from '../../scripts/migrate-database.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('migration 發現', () => {
  it('只載入 SQL migration 並依檔名穩定排序', async () => {
    const directory = await mkdtemp(join(tmpdir(), '身份-migrations-'));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(join(directory, '0002_second.sql'), 'select 2', 'utf8'),
      writeFile(join(directory, '0001_first.sql'), 'select 1', 'utf8'),
      writeFile(join(directory, '說明.md'), '不是 migration', 'utf8')
    ]);

    const migrations = await discoverMigrations(
      pathToFileURL(`${directory}/`)
    );

    expect(migrations).toEqual([
      { name: '0001_first.sql', sql: 'select 1' },
      { name: '0002_second.sql', sql: 'select 2' }
    ]);
  });
});

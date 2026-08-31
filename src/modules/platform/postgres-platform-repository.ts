// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { asc, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { PlatformRepository } from './repository.js';
import type { PlatformVersionRecord } from './types.js';
import * as schema from '../../shared/database/schema.js';

type PlatformDatabase = NodePgDatabase<typeof schema>;
type PlatformVersionRow = typeof schema.platformVersions.$inferSelect;

function mapRecord(row: PlatformVersionRow): PlatformVersionRecord {
  return {
    version: row.version,
    isAvailable: row.isAvailable,
    isCurrent: row.isCurrent,
    note: row.note,
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    displayOrder: row.displayOrder
  };
}

export class PostgresPlatformRepository implements PlatformRepository {
  constructor(private readonly database: PlatformDatabase) {}

  /** display_order 大的是較新的版本，排在清單前面；同序時以版本號穩定排序 */
  async listVersions(): Promise<PlatformVersionRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.platformVersions)
      .orderBy(
        desc(schema.platformVersions.displayOrder),
        asc(schema.platformVersions.version)
      );
    return rows.map(mapRecord);
  }

  async findVersion(version: string): Promise<PlatformVersionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.platformVersions)
      .where(eq(schema.platformVersions.version, version))
      .limit(1);
    return row ? mapRecord(row) : undefined;
  }
}

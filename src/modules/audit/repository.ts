// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  AuditCursor,
  AuditListInput,
  AuditLog,
  RecordAuditInput
} from './types.js';

export type AuditRepositoryListInput = Omit<
  AuditListInput,
  'cursor' | 'limit'
> & {
  cursor?: AuditCursor;
  limit: number;
};

export interface AuditRepository {
  append(input: Required<Pick<RecordAuditInput, 'occurredAt'>> & RecordAuditInput): Promise<AuditLog>;
  list(input: AuditRepositoryListInput): Promise<AuditLog[]>;
}

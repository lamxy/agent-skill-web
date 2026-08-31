// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

export type AuditEventType =
  | 'review.submitted'
  | 'review.approved'
  | 'review.rejected'
  | 'reviewer.assigned'
  | 'reviewer.revoked'
  | 'version.published'
  | 'version.deprecated'
  | 'version.delisted'
  | 'version.emergency_disabled'
  | `admin.${string}`;

export type AuditTargetType = 'package' | 'version' | 'user' | 'role';

export interface AuditLog {
  id: string;
  eventType: AuditEventType;
  actorUid: string;
  targetType: AuditTargetType;
  targetId: string;
  action: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  occurredAt: Date;
}

export type RecordAuditInput = Omit<AuditLog, 'id' | 'occurredAt'> & {
  occurredAt?: Date;
};

export interface AuditListInput {
  eventType?: string;
  actorUid?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

export interface AuditPage {
  items: AuditLog[];
  nextCursor?: string;
}

export interface AuditCursor {
  occurredAt: Date;
  id: string;
}

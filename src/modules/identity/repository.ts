// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  AssignReviewerInput,
  IdentityRecord,
  PackageAuthorizationSnapshot,
  ReviewerAssignment,
  Role,
  RoleAssignment,
  SessionRecord
} from './types.js';

export interface IdentityRepository {
  upsertIdentity(identity: IdentityRecord): Promise<void>;
  findIdentity(uid: string): Promise<IdentityRecord | undefined>;
  listActiveIdentities(): Promise<IdentityRecord[]>;
  createSession(session: SessionRecord): Promise<void>;
  findSession(sessionDigest: string): Promise<SessionRecord | undefined>;
  revokeSession(sessionDigest: string, revokedAt: Date): Promise<void>;
  listActiveRoles(uid: string): Promise<RoleAssignment[]>;
  grantRole(assignment: RoleAssignment): Promise<RoleAssignment>;
  /** 撤銷某人某個角色的所有生效指派。回傳實際撤銷的筆數。 */
  revokeRole(
    uid: string,
    role: Role,
    revokedAt: Date
  ): Promise<number>;
  findPackageSnapshot(
    packageId: string
  ): Promise<PackageAuthorizationSnapshot | undefined>;
  findActiveReviewerAssignment(
    uid: string,
    packageType: string,
    category: string
  ): Promise<ReviewerAssignment | undefined>;
  listActiveReviewerAssignments(): Promise<ReviewerAssignment[]>;
  assignReviewer(
    actorUid: string,
    input: AssignReviewerInput,
    occurredAt: Date
  ): Promise<ReviewerAssignment>;
  revokeReviewer(
    actorUid: string,
    id: string,
    occurredAt: Date
  ): Promise<ReviewerAssignment | undefined>;
}

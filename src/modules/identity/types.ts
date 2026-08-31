// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

export const roleNames = [
  'employee',
  'maintainer',
  'reviewer',
  'platform_admin'
] as const;

export type Role = (typeof roleNames)[number];

export const roleScopeTypes = [
  'global',
  'team',
  'package_type',
  'category',
  'package'
] as const;

export type RoleScopeType = (typeof roleScopeTypes)[number];

export interface RoleScope {
  type: RoleScopeType;
  value?: string;
}

export interface ProviderIdentity {
  uid: string;
  displayName: string;
  teamIds: string[];
}

export interface IdentityRecord extends ProviderIdentity {
  providerType: 'development' | 'oidc';
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ResolvedIdentity =
  | {
      kind: 'authenticated';
      uid: string;
      displayName: string;
      teamIds: string[];
    }
  | { kind: 'anonymous'; anonymousId: string; isNew: boolean };

export interface SessionRecord {
  sessionDigest: string;
  uid: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface RoleAssignment {
  id: string;
  uid: string;
  role: Role;
  scopeType: RoleScopeType;
  scopeValue: string;
  assignedByUid: string;
  active: boolean;
  createdAt: Date;
  revokedAt?: Date;
}

export interface ReviewerAssignment {
  id: string;
  reviewerUid: string;
  packageType: string;
  category: string;
  assignedByUid: string;
  active: boolean;
  createdAt: Date;
  revokedAt?: Date;
  revokedByUid?: string;
}

export interface AssignReviewerInput {
  reviewerUid: string;
  packageType: string;
  category: string;
}

export interface PackageAuthorizationSnapshot {
  packageId: string;
  ownerTeam: string;
  packageType: string;
  category: string;
}

export interface DomainEventRecord {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: 'reviewer.assigned' | 'reviewer.revoked';
  payload: Record<string, unknown>;
  occurredAt: Date;
}

// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import type { AuditRepository } from '../audit/repository.js';
import type { IdentityRepository } from './repository.js';
import type {
  AssignReviewerInput,
  DomainEventRecord,
  IdentityRecord,
  PackageAuthorizationSnapshot,
  ReviewerAssignment,
  Role,
  RoleAssignment,
  SessionRecord
} from './types.js';

interface MemoryIdentityRepositoryState {
  identities?: IdentityRecord[];
  sessions?: SessionRecord[];
  roles?: RoleAssignment[];
  packages?: PackageAuthorizationSnapshot[];
  reviewerAssignments?: ReviewerAssignment[];
  auditRepository?: AuditRepository;
}

function cloneDate(value: Date): Date {
  return new Date(value);
}

function cloneIdentity(value: IdentityRecord): IdentityRecord {
  return {
    ...value,
    teamIds: [...value.teamIds],
    createdAt: cloneDate(value.createdAt),
    updatedAt: cloneDate(value.updatedAt)
  };
}

function cloneSession(value: SessionRecord): SessionRecord {
  return {
    ...value,
    createdAt: cloneDate(value.createdAt),
    expiresAt: cloneDate(value.expiresAt),
    lastSeenAt: cloneDate(value.lastSeenAt),
    ...(value.revokedAt ? { revokedAt: cloneDate(value.revokedAt) } : {})
  };
}

function cloneRole(value: RoleAssignment): RoleAssignment {
  return {
    ...value,
    createdAt: cloneDate(value.createdAt),
    ...(value.revokedAt ? { revokedAt: cloneDate(value.revokedAt) } : {})
  };
}

function cloneReviewer(value: ReviewerAssignment): ReviewerAssignment {
  return {
    ...value,
    createdAt: cloneDate(value.createdAt),
    ...(value.revokedAt ? { revokedAt: cloneDate(value.revokedAt) } : {})
  };
}

export class MemoryIdentityRepository implements IdentityRepository {
  readonly domainEvents: DomainEventRecord[] = [];

  private readonly identities = new Map<string, IdentityRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly roles: RoleAssignment[];
  private readonly packages = new Map<string, PackageAuthorizationSnapshot>();
  private readonly reviewerAssignments: ReviewerAssignment[];
  private readonly auditRepository: AuditRepository | undefined;

  constructor(state: MemoryIdentityRepositoryState = {}) {
    for (const identity of state.identities ?? []) {
      this.identities.set(identity.uid, cloneIdentity(identity));
    }
    for (const session of state.sessions ?? []) {
      this.sessions.set(session.sessionDigest, cloneSession(session));
    }
    this.roles = (state.roles ?? []).map(cloneRole);
    for (const packageSnapshot of state.packages ?? []) {
      this.packages.set(packageSnapshot.packageId, { ...packageSnapshot });
    }
    this.reviewerAssignments = (state.reviewerAssignments ?? []).map(
      cloneReviewer
    );
    this.auditRepository = state.auditRepository;
  }

  async upsertIdentity(identity: IdentityRecord): Promise<void> {
    const existing = this.identities.get(identity.uid);
    this.identities.set(
      identity.uid,
      cloneIdentity({
        ...identity,
        createdAt: existing?.createdAt ?? identity.createdAt
      })
    );
  }

  async findIdentity(uid: string): Promise<IdentityRecord | undefined> {
    const identity = this.identities.get(uid);
    return identity ? cloneIdentity(identity) : undefined;
  }

  async listActiveIdentities(): Promise<IdentityRecord[]> {
    return [...this.identities.values()]
      .filter((identity) => identity.active)
      .toSorted((left, right) => left.uid.localeCompare(right.uid))
      .map(cloneIdentity);
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.sessionDigest, cloneSession(session));
  }

  async findSession(
    sessionDigest: string
  ): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionDigest);
    return session ? cloneSession(session) : undefined;
  }

  async revokeSession(sessionDigest: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionDigest);
    if (session && !session.revokedAt) {
      this.sessions.set(
        sessionDigest,
        cloneSession({ ...session, revokedAt })
      );
    }
  }

  async listActiveRoles(uid: string): Promise<RoleAssignment[]> {
    return this.roles
      .filter((assignment) => assignment.uid === uid && assignment.active)
      .map(cloneRole);
  }

  async grantRole(assignment: RoleAssignment): Promise<RoleAssignment> {
    const existing = this.roles.find(
      (candidate) =>
        candidate.uid === assignment.uid &&
        candidate.role === assignment.role &&
        candidate.scopeType === assignment.scopeType &&
        candidate.scopeValue === assignment.scopeValue &&
        candidate.active
    );
    if (existing) {
      return cloneRole(existing);
    }
    const stored = cloneRole(assignment);
    this.roles.push(stored);
    return cloneRole(stored);
  }

  async revokeRole(uid: string, role: Role, revokedAt: Date): Promise<number> {
    let revoked = 0;
    for (const [index, candidate] of this.roles.entries()) {
      if (candidate.uid === uid && candidate.role === role && candidate.active) {
        this.roles[index] = { ...candidate, active: false, revokedAt };
        revoked += 1;
      }
    }
    return revoked;
  }

  async findPackageSnapshot(
    packageId: string
  ): Promise<PackageAuthorizationSnapshot | undefined> {
    const packageSnapshot = this.packages.get(packageId);
    return packageSnapshot ? { ...packageSnapshot } : undefined;
  }

  async findActiveReviewerAssignment(
    uid: string,
    packageType: string,
    category: string
  ): Promise<ReviewerAssignment | undefined> {
    const assignment = this.reviewerAssignments.find(
      (candidate) =>
        candidate.reviewerUid === uid &&
        candidate.packageType === packageType &&
        candidate.category === category &&
        candidate.active
    );
    return assignment ? cloneReviewer(assignment) : undefined;
  }

  async listActiveReviewerAssignments(): Promise<ReviewerAssignment[]> {
    return this.reviewerAssignments
      .filter((assignment) => assignment.active)
      .toSorted((left, right) => {
        const byCreatedAt =
          right.createdAt.getTime() - left.createdAt.getTime();
        return byCreatedAt || right.id.localeCompare(left.id);
      })
      .map(cloneReviewer);
  }

  async assignReviewer(
    actorUid: string,
    input: AssignReviewerInput,
    occurredAt: Date
  ): Promise<ReviewerAssignment> {
    const existing = await this.findActiveReviewerAssignment(
      input.reviewerUid,
      input.packageType,
      input.category
    );
    if (existing) {
      return existing;
    }

    const assignment: ReviewerAssignment = {
      id: randomUUID(),
      reviewerUid: input.reviewerUid,
      packageType: input.packageType,
      category: input.category,
      assignedByUid: actorUid,
      active: true,
      createdAt: occurredAt
    };
    await this.auditRepository?.append({
      eventType: 'reviewer.assigned',
      actorUid,
      targetType: 'role',
      targetId: assignment.id,
      action: 'assign_reviewer',
      details: {
        reviewerUid: input.reviewerUid,
        packageType: input.packageType,
        category: input.category
      },
      occurredAt
    });
    this.reviewerAssignments.push(cloneReviewer(assignment));
    this.domainEvents.push({
      id: randomUUID(),
      aggregateType: 'reviewer_assignment',
      aggregateId: assignment.id,
      eventType: 'reviewer.assigned',
      payload: {
        actorUid,
        reviewerUid: input.reviewerUid,
        packageType: input.packageType,
        category: input.category
      },
      occurredAt: cloneDate(occurredAt)
    });
    return cloneReviewer(assignment);
  }

  async revokeReviewer(
    actorUid: string,
    id: string,
    occurredAt: Date
  ): Promise<ReviewerAssignment | undefined> {
    const index = this.reviewerAssignments.findIndex(
      (assignment) => assignment.id === id
    );
    if (index < 0) {
      return undefined;
    }
    const existing = this.reviewerAssignments[index];
    if (!existing) {
      return undefined;
    }
    if (!existing.active) {
      return cloneReviewer(existing);
    }

    const revoked: ReviewerAssignment = {
      ...existing,
      active: false,
      revokedAt: occurredAt,
      revokedByUid: actorUid
    };
    await this.auditRepository?.append({
      eventType: 'reviewer.revoked',
      actorUid,
      targetType: 'role',
      targetId: revoked.id,
      action: 'revoke_reviewer',
      details: {
        reviewerUid: revoked.reviewerUid,
        packageType: revoked.packageType,
        category: revoked.category
      },
      occurredAt
    });
    this.reviewerAssignments[index] = cloneReviewer(revoked);
    this.domainEvents.push({
      id: randomUUID(),
      aggregateType: 'reviewer_assignment',
      aggregateId: revoked.id,
      eventType: 'reviewer.revoked',
      payload: {
        actorUid,
        reviewerUid: revoked.reviewerUid,
        packageType: revoked.packageType,
        category: revoked.category
      },
      occurredAt: cloneDate(occurredAt)
    });
    return cloneReviewer(revoked);
  }
}

// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { IdentityRepository } from './repository.js';
import type {
  AssignReviewerInput,
  IdentityRecord,
  PackageAuthorizationSnapshot,
  ReviewerAssignment,
  Role,
  RoleAssignment,
  RoleScopeType,
  SessionRecord
} from './types.js';
import * as schema from '../../shared/database/schema.js';

type IdentityDatabase = NodePgDatabase<typeof schema>;

function mapIdentity(
  row: typeof schema.identities.$inferSelect
): IdentityRecord {
  return {
    uid: row.uid,
    displayName: row.displayName,
    teamIds: [...row.teamIds],
    providerType: row.providerType as IdentityRecord['providerType'],
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapSession(
  row: typeof schema.identitySessions.$inferSelect
): SessionRecord {
  return {
    sessionDigest: row.sessionDigest,
    uid: row.uid,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {})
  };
}

function mapRole(
  row: typeof schema.roleAssignments.$inferSelect
): RoleAssignment {
  return {
    id: row.id,
    uid: row.uid,
    role: row.role as Role,
    scopeType: row.scopeType as RoleScopeType,
    scopeValue: row.scopeValue,
    assignedByUid: row.assignedByUid,
    active: row.active,
    createdAt: row.createdAt,
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {})
  };
}

function mapReviewer(
  row: typeof schema.reviewerAssignments.$inferSelect
): ReviewerAssignment {
  return {
    id: row.id,
    reviewerUid: row.reviewerUid,
    packageType: row.packageType,
    category: row.category,
    assignedByUid: row.assignedByUid,
    active: row.active,
    createdAt: row.createdAt,
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
    ...(row.revokedByUid ? { revokedByUid: row.revokedByUid } : {})
  };
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly database: IdentityDatabase) {}

  async upsertIdentity(identity: IdentityRecord): Promise<void> {
    await this.database
      .insert(schema.identities)
      .values({
        uid: identity.uid,
        displayName: identity.displayName,
        teamIds: [...identity.teamIds],
        providerType: identity.providerType,
        active: identity.active,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt
      })
      .onConflictDoUpdate({
        target: schema.identities.uid,
        set: {
          displayName: identity.displayName,
          teamIds: [...identity.teamIds],
          providerType: identity.providerType,
          active: identity.active,
          updatedAt: identity.updatedAt
        }
      });
  }

  async findIdentity(uid: string): Promise<IdentityRecord | undefined> {
    const rows = await this.database
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.uid, uid))
      .limit(1);
    return rows[0] ? mapIdentity(rows[0]) : undefined;
  }

  async listActiveIdentities(): Promise<IdentityRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.active, true))
      .orderBy(asc(schema.identities.uid));
    return rows.map(mapIdentity);
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.database.insert(schema.identitySessions).values({
      sessionDigest: session.sessionDigest,
      uid: session.uid,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      createdAt: session.createdAt,
      ...(session.revokedAt ? { revokedAt: session.revokedAt } : {})
    });
  }

  async findSession(
    sessionDigest: string
  ): Promise<SessionRecord | undefined> {
    const rows = await this.database
      .select()
      .from(schema.identitySessions)
      .where(eq(schema.identitySessions.sessionDigest, sessionDigest))
      .limit(1);
    return rows[0] ? mapSession(rows[0]) : undefined;
  }

  async revokeSession(sessionDigest: string, revokedAt: Date): Promise<void> {
    await this.database
      .update(schema.identitySessions)
      .set({ revokedAt })
      .where(
        and(
          eq(schema.identitySessions.sessionDigest, sessionDigest),
          isNull(schema.identitySessions.revokedAt)
        )
      );
  }

  async listActiveRoles(uid: string): Promise<RoleAssignment[]> {
    const rows = await this.database
      .select()
      .from(schema.roleAssignments)
      .where(
        and(
          eq(schema.roleAssignments.uid, uid),
          eq(schema.roleAssignments.active, true)
        )
      );
    return rows.map(mapRole);
  }

  async grantRole(assignment: RoleAssignment): Promise<RoleAssignment> {
    const inserted = await this.database
      .insert(schema.roleAssignments)
      .values({
        id: assignment.id,
        uid: assignment.uid,
        role: assignment.role,
        scopeType: assignment.scopeType,
        scopeValue: assignment.scopeValue,
        assignedByUid: assignment.assignedByUid,
        active: assignment.active,
        createdAt: assignment.createdAt,
        ...(assignment.revokedAt ? { revokedAt: assignment.revokedAt } : {})
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      return mapRole(inserted[0]);
    }

    const existing = await this.database
      .select()
      .from(schema.roleAssignments)
      .where(
        and(
          eq(schema.roleAssignments.uid, assignment.uid),
          eq(schema.roleAssignments.role, assignment.role),
          eq(schema.roleAssignments.scopeType, assignment.scopeType),
          eq(schema.roleAssignments.scopeValue, assignment.scopeValue),
          eq(schema.roleAssignments.active, true)
        )
      )
      .limit(1);
    if (!existing[0]) {
      throw new Error('角色指派衝突後未找到有效記錄');
    }
    return mapRole(existing[0]);
  }

  async revokeRole(uid: string, role: Role, revokedAt: Date): Promise<number> {
    const revoked = await this.database
      .update(schema.roleAssignments)
      .set({ active: false, revokedAt })
      .where(
        and(
          eq(schema.roleAssignments.uid, uid),
          eq(schema.roleAssignments.role, role),
          eq(schema.roleAssignments.active, true)
        )
      )
      .returning({ id: schema.roleAssignments.id });
    return revoked.length;
  }

  async findPackageSnapshot(
    packageId: string
  ): Promise<PackageAuthorizationSnapshot | undefined> {
    const rows = await this.database
      .select({
        packageId: schema.packages.packageId,
        ownerTeam: schema.packages.ownerTeam,
        packageType: schema.packages.type,
        category: schema.packages.category
      })
      .from(schema.packages)
      .where(eq(schema.packages.packageId, packageId))
      .limit(1);
    return rows[0];
  }

  async findActiveReviewerAssignment(
    uid: string,
    packageType: string,
    category: string
  ): Promise<ReviewerAssignment | undefined> {
    const rows = await this.database
      .select()
      .from(schema.reviewerAssignments)
      .where(
        and(
          eq(schema.reviewerAssignments.reviewerUid, uid),
          eq(schema.reviewerAssignments.packageType, packageType),
          eq(schema.reviewerAssignments.category, category),
          eq(schema.reviewerAssignments.active, true)
        )
      )
      .limit(1);
    return rows[0] ? mapReviewer(rows[0]) : undefined;
  }

  async listActiveReviewerAssignments(): Promise<ReviewerAssignment[]> {
    const rows = await this.database
      .select()
      .from(schema.reviewerAssignments)
      .where(eq(schema.reviewerAssignments.active, true))
      .orderBy(
        desc(schema.reviewerAssignments.createdAt),
        desc(schema.reviewerAssignments.id)
      );
    return rows.map(mapReviewer);
  }

  async assignReviewer(
    actorUid: string,
    input: AssignReviewerInput,
    occurredAt: Date
  ): Promise<ReviewerAssignment> {
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(schema.reviewerAssignments)
        .values({
          reviewerUid: input.reviewerUid,
          packageType: input.packageType,
          category: input.category,
          assignedByUid: actorUid,
          active: true,
          createdAt: occurredAt
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) {
        const existing = await transaction
          .select()
          .from(schema.reviewerAssignments)
          .where(
            and(
              eq(schema.reviewerAssignments.reviewerUid, input.reviewerUid),
              eq(schema.reviewerAssignments.packageType, input.packageType),
              eq(schema.reviewerAssignments.category, input.category),
              eq(schema.reviewerAssignments.active, true)
            )
          )
          .limit(1);
        if (!existing[0]) {
          throw new Error('審核人指派衝突後未找到有效記錄');
        }
        return mapReviewer(existing[0]);
      }

      const assignment = mapReviewer(inserted[0]);
      await transaction.insert(schema.auditLogs).values({
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
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'reviewer_assignment',
        aggregateId: assignment.id,
        eventType: 'reviewer.assigned',
        payload: {
          actorUid,
          reviewerUid: input.reviewerUid,
          packageType: input.packageType,
          category: input.category
        },
        occurredAt
      });
      return assignment;
    });
  }

  async revokeReviewer(
    actorUid: string,
    id: string,
    occurredAt: Date
  ): Promise<ReviewerAssignment | undefined> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction
        .select()
        .from(schema.reviewerAssignments)
        .where(eq(schema.reviewerAssignments.id, id))
        .limit(1);
      if (!existing[0]) {
        return undefined;
      }
      if (!existing[0].active) {
        return mapReviewer(existing[0]);
      }

      const updated = await transaction
        .update(schema.reviewerAssignments)
        .set({
          active: false,
          revokedAt: occurredAt,
          revokedByUid: actorUid
        })
        .where(
          and(
            eq(schema.reviewerAssignments.id, id),
            eq(schema.reviewerAssignments.active, true)
          )
        )
        .returning();
      if (!updated[0]) {
        const current = await transaction
          .select()
          .from(schema.reviewerAssignments)
          .where(eq(schema.reviewerAssignments.id, id))
          .limit(1);
        return current[0] ? mapReviewer(current[0]) : undefined;
      }

      const assignment = mapReviewer(updated[0]);
      await transaction.insert(schema.auditLogs).values({
        eventType: 'reviewer.revoked',
        actorUid,
        targetType: 'role',
        targetId: assignment.id,
        action: 'revoke_reviewer',
        details: {
          reviewerUid: assignment.reviewerUid,
          packageType: assignment.packageType,
          category: assignment.category
        },
        occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'reviewer_assignment',
        aggregateId: assignment.id,
        eventType: 'reviewer.revoked',
        payload: {
          actorUid,
          reviewerUid: assignment.reviewerUid,
          packageType: assignment.packageType,
          category: assignment.category
        },
        occurredAt
      });
      return assignment;
    });
  }
}

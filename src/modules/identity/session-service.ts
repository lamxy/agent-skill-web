// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { IdentityRepository } from './repository.js';
import type { ResolvedIdentity } from './types.js';
import { AppError } from '../../shared/errors/app-error.js';

const anonymousIdSchema = z.string().uuid();
const DEFAULT_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

interface SessionServiceOptions {
  repository: IdentityRepository;
  clock?: () => Date;
  sessionTokenFactory?: () => string;
  anonymousIdFactory?: () => string;
  sessionDurationMs?: number;
}

interface ResolveIdentityInput {
  sessionToken?: string;
  anonymousId?: string;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionService {
  private readonly repository: IdentityRepository;
  private readonly clock: () => Date;
  private readonly sessionTokenFactory: () => string;
  private readonly anonymousIdFactory: () => string;
  private readonly sessionDurationMs: number;

  constructor(options: SessionServiceOptions) {
    this.repository = options.repository;
    this.clock = options.clock ?? (() => new Date());
    this.sessionTokenFactory =
      options.sessionTokenFactory ?? (() => randomBytes(32).toString('base64url'));
    this.anonymousIdFactory = options.anonymousIdFactory ?? randomUUID;
    this.sessionDurationMs =
      options.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS;
  }

  async create(uid: string): Promise<{ token: string; expiresAt: Date }> {
    const identity = await this.repository.findIdentity(uid);
    if (!identity?.active) {
      throw new AppError({
        statusCode: 401,
        code: 'IDENTITY_INACTIVE',
        message: '身份不可用'
      });
    }

    const token = this.sessionTokenFactory();
    const createdAt = this.clock();
    const expiresAt = new Date(createdAt.getTime() + this.sessionDurationMs);
    await this.repository.createSession({
      sessionDigest: hashSessionToken(token),
      uid,
      expiresAt,
      lastSeenAt: createdAt,
      createdAt
    });
    return { token, expiresAt };
  }

  async resolve(input: ResolveIdentityInput): Promise<ResolvedIdentity> {
    if (input.sessionToken) {
      const session = await this.repository.findSession(
        hashSessionToken(input.sessionToken)
      );
      const currentTime = this.clock();
      if (
        session &&
        !session.revokedAt &&
        session.expiresAt.getTime() > currentTime.getTime()
      ) {
        const identity = await this.repository.findIdentity(session.uid);
        if (identity?.active) {
          return {
            kind: 'authenticated',
            uid: identity.uid,
            displayName: identity.displayName,
            teamIds: [...identity.teamIds]
          };
        }
      }
    }

    const existingAnonymousId = anonymousIdSchema.safeParse(input.anonymousId);
    if (existingAnonymousId.success) {
      return {
        kind: 'anonymous',
        anonymousId: existingAnonymousId.data,
        isNew: false
      };
    }
    return {
      kind: 'anonymous',
      anonymousId: this.anonymousIdFactory(),
      isNew: true
    };
  }

  async logout(token: string): Promise<void> {
    await this.repository.revokeSession(hashSessionToken(token), this.clock());
  }
}

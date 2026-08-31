// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { AppError } from '../../shared/errors/app-error.js';
import type { CatalogRepository } from '../catalog/repository.js';
import type { CatalogAggregate } from '../catalog/types.js';
import type { AuthorizationService } from '../identity/authorization-service.js';
import type { ResolvedIdentity } from '../identity/types.js';
import { summarizeFeedback } from './feedback-model.js';
import type { ExperienceRepository } from './repository.js';
import {
  SUPPORT_CHANNEL_TYPES,
  type FeedbackListFilters,
  type FeedbackRecord,
  type FeedbackStatus,
  type FeedbackSummary,
  type SubmitFeedbackInput,
  type SupportChannel,
  type SupportChannelContent
} from './types.js';

const MAX_SUPPORT_CHANNELS = 10;

export class ExperienceService {
  constructor(
    private readonly repository: ExperienceRepository,
    private readonly catalogRepository: CatalogRepository,
    private readonly authorization: AuthorizationService,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /**
   * 支援入口對所有能看到該套件的身分開放：員工遇到問題時需要能直接找到人，
   * 不應要求先登入才看得到求助管道。
   */
  async listSupportChannels(
    packageId: string,
    identity: ResolvedIdentity
  ): Promise<SupportChannel[]> {
    await this.requireVisiblePackage(packageId, identity);
    return this.repository.listSupportChannels(packageId);
  }

  async saveSupportChannels(
    packageId: string,
    channels: SupportChannelContent[],
    identity: ResolvedIdentity
  ): Promise<SupportChannel[]> {
    const aggregate = await this.requireExistingPackage(packageId);
    const actorUid = await this.requireMaintainer(
      identity,
      aggregate.package.ownerTeam
    );
    return this.repository.saveSupportChannels({
      packageId,
      channels: validateChannels(channels),
      actorUid,
      occurredAt: this.clock()
    });
  }

  /**
   * 反饋開放給匿名 UUID：安裝腳本的使用者不一定登入，
   * 要求登入會讓最需要協助的失敗案例回報不上來。
   */
  async submitFeedback(
    input: SubmitFeedbackInput,
    identity: ResolvedIdentity
  ): Promise<FeedbackRecord> {
    const aggregate = await this.requireVisiblePackage(input.packageId, identity);
    if (!aggregate.versions.some((version) => version.version === input.version)) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_VERSION_NOT_FOUND',
        message: '找不到套件版本'
      });
    }
    const detail = input.detail.trim();
    if (!detail) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: '詳細描述不能為空'
      });
    }
    return this.repository.submitFeedback({
      ...input,
      detail,
      ...(identity.kind === 'authenticated'
        ? { authorRefType: 'uid' as const, authorRef: identity.uid }
        : { authorRefType: 'uuid' as const, authorRef: identity.anonymousId }),
      occurredAt: this.clock()
    });
  }

  /**
   * 反饋明細含自由文字，只有維護者可讀；一般員工看不到他人的回報內容。
   */
  async listFeedback(
    filters: FeedbackListFilters,
    identity: ResolvedIdentity
  ): Promise<FeedbackRecord[]> {
    const aggregate = await this.requireExistingPackage(filters.packageId);
    await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    return this.repository.listFeedback(filters);
  }

  async getFeedbackSummary(
    packageId: string,
    identity: ResolvedIdentity
  ): Promise<FeedbackSummary> {
    const aggregate = await this.requireExistingPackage(packageId);
    await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    return summarizeFeedback(
      packageId,
      await this.repository.listFeedback({ packageId })
    );
  }

  async updateFeedbackStatus(
    feedbackId: string,
    status: FeedbackStatus,
    identity: ResolvedIdentity
  ): Promise<FeedbackRecord> {
    const feedback = await this.repository.findFeedback(feedbackId);
    if (!feedback) {
      throw new AppError({
        statusCode: 404,
        code: 'FEEDBACK_NOT_FOUND',
        message: '找不到反饋紀錄'
      });
    }
    const aggregate = await this.requireExistingPackage(feedback.packageId);
    const actorUid = await this.requireMaintainer(
      identity,
      aggregate.package.ownerTeam
    );
    const updated = await this.repository.updateFeedbackStatus({
      feedbackId,
      status,
      actorUid,
      occurredAt: this.clock()
    });
    if (!updated) {
      throw new AppError({
        statusCode: 404,
        code: 'FEEDBACK_NOT_FOUND',
        message: '找不到反饋紀錄'
      });
    }
    return updated;
  }

  private async requireVisiblePackage(
    packageId: string,
    identity: ResolvedIdentity
  ): Promise<CatalogAggregate> {
    const aggregate = await this.catalogRepository.findAggregate(packageId);
    const visible =
      aggregate &&
      aggregate.package.lifecycle === 'active' &&
      (aggregate.package.visibility === 'public' ||
        identity.kind === 'authenticated');
    if (!aggregate || !visible) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_NOT_FOUND',
        message: '找不到可存取的套件'
      });
    }
    return aggregate;
  }

  private async requireExistingPackage(
    packageId: string
  ): Promise<CatalogAggregate> {
    const aggregate = await this.catalogRepository.findAggregate(packageId);
    if (!aggregate) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_NOT_FOUND',
        message: '找不到套件'
      });
    }
    return aggregate;
  }

  private async requireMaintainer(
    identity: ResolvedIdentity,
    ownerTeam: string
  ): Promise<string> {
    if (identity.kind !== 'authenticated') {
      throw new AppError({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: '請先登入'
      });
    }
    const isAdmin = await this.authorization.hasRole(
      identity.uid, 'platform_admin', { type: 'global' }
    );
    const isGlobalMaintainer = await this.authorization.hasRole(
      identity.uid, 'maintainer', { type: 'global' }
    );
    const isTeamMaintainer =
      identity.teamIds.includes(ownerTeam) &&
      (await this.authorization.hasRole(
        identity.uid, 'maintainer', { type: 'team', value: ownerTeam }
      ));
    if (!isAdmin && !isGlobalMaintainer && !isTeamMaintainer) {
      throw new AppError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: '沒有維護此套件的權限'
      });
    }
    return identity.uid;
  }
}

function validateChannels(
  channels: SupportChannelContent[]
): SupportChannelContent[] {
  if (channels.length > MAX_SUPPORT_CHANNELS) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: `支援渠道最多 ${MAX_SUPPORT_CHANNELS} 筆`
    });
  }
  const seen = new Set<string>();
  return channels.map((channel, index) => {
    if (!SUPPORT_CHANNEL_TYPES.includes(channel.channelType)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: '不支援的支援渠道類型'
      });
    }
    const label = channel.label.trim();
    const address = channel.address.trim();
    if (!label || !address) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: '支援渠道的名稱與位址皆為必填'
      });
    }
    const key = `${channel.channelType}::${address}`;
    if (seen.has(key)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: '同類型的支援渠道位址重複'
      });
    }
    seen.add(key);
    const instructions = channel.instructions?.trim();
    return {
      channelType: channel.channelType,
      label,
      address,
      ...(instructions ? { instructions } : {}),
      displayOrder: Number.isSafeInteger(channel.displayOrder)
        ? Math.max(channel.displayOrder, 0)
        : index
    };
  });
}

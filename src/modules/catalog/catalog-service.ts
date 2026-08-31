// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { AuthorizationService } from '../identity/authorization-service.js';
import type { ResolvedIdentity } from '../identity/types.js';
import type { GovernanceRepository } from '../governance/repository.js';
import { AppError } from '../../shared/errors/app-error.js';
import { compareSemanticVersions } from '../../shared/version/semantic-version.js';
import type { CatalogRepository } from './repository.js';
import { calculateVersionDiff } from './version-diff-model.js';
import type { VersionDiff } from './version-diff-model.js';
import type {
  CatalogAggregate,
  CatalogDetail,
  CatalogSearchFilters,
  CatalogSearchResult,
  CatalogSummary,
  CopyScriptTargetRevisionInput,
  CreatePackageInput,
  CreatePackageVersionInput,
  CreateScriptTargetInput,
  MaintainedPackageFilters,
  MaintainedPackageResult,
  MaintainedPackageSummary,
  MaintainedScope,
  PackageDownload,
  PackageRecord,
  PackageVersionRecord,
  SaveScriptTargetRevisionInput,
  ScriptTargetRecord,
  ScriptTargetRevision,
  SetPackageGradeInput,
  UpdatePackageInput,
  UpdatePackageVersionInput
} from './types.js';

/* 維護清單每頁筆數。個人視角的集合，一頁看得完比一直翻頁重要 */
const MAINTAINED_PAGE_SIZE = 20;

function versionDescending(
  left: PackageVersionRecord,
  right: PackageVersionRecord
): number {
  return right.version.localeCompare(left.version, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function canBrowsePackage(
  aggregate: CatalogAggregate,
  identity: ResolvedIdentity
): boolean {
  return (
    aggregate.package.lifecycle === 'active' &&
    (aggregate.package.visibility === 'public' ||
      identity.kind === 'authenticated')
  );
}

function matchesFilters(
  aggregate: CatalogAggregate,
  publishedVersions: PackageVersionRecord[],
  filters: CatalogSearchFilters
): boolean {
  const keyword = filters.keyword?.trim().toLocaleLowerCase();
  if (
    keyword &&
    ![
      aggregate.package.packageId,
      aggregate.package.name,
      aggregate.package.purpose,
      aggregate.package.category
    ].some((value) => value.toLocaleLowerCase().includes(keyword))
  ) {
    return false;
  }
  if (filters.category && aggregate.package.category !== filters.category) {
    return false;
  }
  if (
    filters.categoryCode &&
    aggregate.package.categoryCode !== filters.categoryCode
  ) {
    return false;
  }
  if (filters.grade && aggregate.package.grade !== filters.grade) {
    return false;
  }
  if (filters.source && aggregate.package.source !== filters.source) {
    return false;
  }
  if (
    filters.client &&
    !publishedVersions.some((version) =>
      version.supportedClients.some((client) => client.name === filters.client)
    )
  ) {
    return false;
  }
  if (
    filters.os &&
    !publishedVersions.some((version) => version.supportedOs.includes(filters.os!))
  ) {
    return false;
  }
  return true;
}

export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly authorization: AuthorizationService,
    private readonly clock: () => Date = () => new Date(),
    private readonly governanceRepository?: GovernanceRepository
  ) {}

  async createPackage(
    input: CreatePackageInput,
    identity: ResolvedIdentity
  ): Promise<PackageRecord> {
    const uid = await this.requireMaintainer(identity, input.ownerTeam);
    if (await this.repository.findAggregate(input.packageId)) {
      throw new AppError({ statusCode: 409, code: 'PACKAGE_ALREADY_EXISTS', message: '套件識別碼已存在' });
    }
    /*
     * 未指定發布者時由 ownerTeam 推導。技能是團隊資產而非個人資產——
     * 維護權限綁團隊，人員異動時技能仍有歸屬，因此發布者即所屬團隊。
     */
    const publisher = input.publisher ?? {
      kind: 'organization' as const,
      name: input.ownerTeam
    };
    return this.repository.createPackage(
      uid,
      { ...input, publisher },
      this.clock()
    );
  }

  async updatePackage(
    packageId: string,
    input: UpdatePackageInput,
    identity: ResolvedIdentity
  ): Promise<PackageRecord> {
    const aggregate = await this.requireExistingPackage(packageId);
    const uid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    const updated = await this.repository.updatePackage(uid, packageId, input, this.clock());
    if (!updated) throw this.packageNotFound();
    return updated;
  }

  /**
   * 核定技能分級。
   *
   * 權責與維護分離：維護者能改名稱、用途、分類，但不能決定自己技能的分級，
   * 否則列表上的「精品」與「全員推廣」等同自封，失去篩選價值。
   * 判斷沿用 canReview（reviewer 或 platform_admin），與審核決議同一組人。
   *
   * 不綁在審核決議上：改分級是發布後的常態操作，
   * 若只能在核准當下設定，之後想調整就得逼發布者重新送審一個無關的版本。
   */
  async setPackageGrade(
    packageId: string,
    input: SetPackageGradeInput,
    identity: ResolvedIdentity
  ): Promise<PackageRecord> {
    const aggregate = await this.requireExistingPackage(packageId);
    if (identity.kind !== 'authenticated') {
      throw new AppError({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: '請先登入'
      });
    }
    if (!(await this.authorization.canReview(identity.uid, packageId))) {
      throw new AppError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: '只有審核人可以核定技能分級'
      });
    }
    if (aggregate.package.lifecycle !== 'active') {
      throw new AppError({
        statusCode: 409,
        code: 'PACKAGE_ARCHIVED',
        message: '已封存的技能不能變更分級'
      });
    }
    const updated = await this.repository.setPackageGrade(
      identity.uid,
      packageId,
      input,
      this.clock()
    );
    if (!updated) throw this.packageNotFound();
    return updated;
  }

  async archivePackage(
    packageId: string,
    identity: ResolvedIdentity
  ): Promise<PackageRecord> {
    const aggregate = await this.requireExistingPackage(packageId);
    const uid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    const archived = await this.repository.archivePackage(uid, packageId, this.clock());
    if (!archived) throw this.packageNotFound();
    return archived;
  }

  async createVersion(
    packageId: string,
    input: CreatePackageVersionInput,
    identity: ResolvedIdentity
  ): Promise<PackageVersionRecord> {
    const aggregate = await this.requireExistingPackage(packageId);
    const uid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    if (aggregate.versions.some((version) => version.version === input.version)) {
      throw new AppError({ statusCode: 409, code: 'PACKAGE_VERSION_ALREADY_EXISTS', message: '套件版本已存在' });
    }
    return this.repository.createVersion(uid, packageId, input, this.clock());
  }

  async updateVersion(
    packageId: string,
    version: string,
    input: UpdatePackageVersionInput,
    identity: ResolvedIdentity
  ): Promise<PackageVersionRecord> {
    if (Object.hasOwn(input as object, 'lifecycle')) {
      throw new AppError({
        statusCode: 400,
        code: 'LIFECYCLE_MANAGED_BY_GOVERNANCE',
        message: '版本生命週期只能由發布治理流程變更'
      });
    }
    const aggregate = await this.requireExistingPackage(packageId);
    const uid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    const current = aggregate.versions.find((candidate) => candidate.version === version);
    if (!current) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    if (!this.governanceRepository && current.lifecycle !== 'draft') {
      throw new AppError({
        statusCode: 409,
        code: 'INVALID_VERSION_TRANSITION',
        message: '非草稿版本必須透過治理交易修改'
      });
    }
    const updated = this.governanceRepository
      ? await this.governanceRepository.updateVersionContent({
          packageId, version, actorUid: uid, patch: input,
          occurredAt: this.clock()
        })
      : await this.repository.updateVersion(
          uid, packageId, version, input, this.clock()
        );
    if (!updated) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    return updated;
  }

  async getVersion(
    packageId: string,
    version: string,
    identity: ResolvedIdentity
  ): Promise<PackageVersionRecord> {
    const { current } = await this.requireMutableVersion(packageId, version, identity, false);
    return current;
  }

  async createScriptTarget(
    packageId: string,
    version: string,
    input: CreateScriptTargetInput,
    identity: ResolvedIdentity
  ): Promise<ScriptTargetRecord> {
    const { uid } = await this.requireMutableVersion(packageId, version, identity);
    return this.repository.createScriptTarget(uid, packageId, version, input, this.clock());
  }

  async saveScriptTargetRevision(
    packageId: string,
    version: string,
    targetId: string,
    input: SaveScriptTargetRevisionInput,
    identity: ResolvedIdentity
  ): Promise<ScriptTargetRecord> {
    const { uid } = await this.requireMutableVersion(packageId, version, identity);
    try {
      return await this.repository.saveScriptTargetRevision(
        uid, packageId, version, targetId, input, this.clock()
      );
    } catch (error) {
      throw this.mapScriptValidationError(error);
    }
  }

  async copyScriptTargetRevision(
    packageId: string,
    version: string,
    targetId: string,
    input: CopyScriptTargetRevisionInput,
    identity: ResolvedIdentity
  ): Promise<ScriptTargetRecord> {
    const { uid } = await this.requireMutableVersion(packageId, version, identity);
    try {
      return await this.repository.copyScriptTargetRevision(
        uid, packageId, version, targetId, input, this.clock()
      );
    } catch (error) {
      throw this.mapScriptValidationError(error);
    }
  }

  async softDeleteScriptTarget(
    packageId: string,
    version: string,
    targetId: string,
    expectedScriptVersion: number,
    identity: ResolvedIdentity
  ): Promise<ScriptTargetRecord> {
    const { uid } = await this.requireMutableVersion(packageId, version, identity);
    return this.repository.softDeleteScriptTarget(
      uid,
      packageId,
      version,
      targetId,
      expectedScriptVersion,
      this.clock()
    );
  }

  async getScriptTargetRevisions(
    packageId: string,
    version: string,
    targetId: string,
    identity: ResolvedIdentity
  ): Promise<ScriptTargetRevision[]> {
    await this.requireMutableVersion(packageId, version, identity, false);
    const target = await this.repository.findScriptTarget(
      packageId, version, targetId, true
    );
    if (!target) {
      throw new AppError({ statusCode: 404, code: 'SCRIPT_TARGET_NOT_FOUND', message: '找不到腳本目標' });
    }
    return target.revisions;
  }

  async search(
    filters: CatalogSearchFilters,
    identity: ResolvedIdentity
  ): Promise<CatalogSearchResult> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = filters.cursor ? Number.parseInt(filters.cursor, 10) : 0;
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const summaries = (await this.repository.listAggregates())
      .filter((aggregate) => canBrowsePackage(aggregate, identity))
      .flatMap((aggregate): CatalogSummary[] => {
        const published = aggregate.versions
          .filter((version) => version.lifecycle === 'published')
          .sort(versionDescending);
        if (!published[0] || !matchesFilters(aggregate, published, filters)) {
          return [];
        }
        return [{ ...aggregate.package, latestVersion: published[0] }];
      });

    summaries.sort((left, right) => {
      let order: number;
      if (filters.sort === 'name_desc') {
        order = right.name.localeCompare(left.name);
      } else if (filters.sort === 'updated_desc') {
        order = right.updatedAt.getTime() - left.updatedAt.getTime();
      } else {
        order = left.name.localeCompare(right.name);
      }
      return order || left.packageId.localeCompare(right.packageId);
    });

    const items = summaries.slice(safeOffset, safeOffset + limit);
    const nextOffset = safeOffset + items.length;
    return {
      items,
      ...(nextOffset < summaries.length ? { nextCursor: String(nextOffset) } : {}),
      state: items.length === 0 ? 'empty' : 'success'
    };
  }

  /**
   * 呼叫者有維護權限的套件，含尚無已發布版本者。
   *
   * 不能用 search 代替：search 只回傳有 published 版本的套件，
   * 新建立的技能會立刻從清單消失，使用者無從為它填寫第一個版本。
   *
   * 授權判斷必須與 requireMaintainer 完全一致，否則清單會列出
   * 使用者點進去才發現不能操作的套件。
   */
  async listMaintainedPackages(
    filters: MaintainedPackageFilters,
    identity: ResolvedIdentity
  ): Promise<MaintainedPackageResult> {
    if (identity.kind !== 'authenticated') {
      throw new AppError({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: '請先登入'
      });
    }
    const [isAdmin, isGlobalMaintainer] = await Promise.all([
      this.authorization.hasRole(identity.uid, 'platform_admin', { type: 'global' }),
      this.authorization.hasRole(identity.uid, 'maintainer', { type: 'global' })
    ]);
    const canIncludeAllTeams = isAdmin || isGlobalMaintainer;
    const teamScopedMaintainerTeams =
      await this.authorization.listOwnScopedTeams(identity.uid, 'maintainer');

    /*
     * 範圍解析。includeAllTeams 是 scope 之前的參數，等價於 scope: 'all'；
     * 兩者同時出現時以 scope 為準。無權使用 'all' 時退回 'team' 而非報錯——
     * 前端可以送任何值，權限由此處判定。
     */
    const requested: MaintainedScope =
      filters.scope ?? (filters.includeAllTeams ? 'all' : 'team');
    const scope: MaintainedScope =
      requested === 'all' && !canIncludeAllTeams ? 'team' : requested;

    /** 自己建立的。createdByUid 不參與授權判斷，只決定歸屬顯示。 */
    const isMine = (aggregate: CatalogAggregate): boolean =>
      aggregate.package.createdByUid === identity.uid;

    /*
     * team 範圍的收錄條件，任一成立：
     *   1. 技能是自己建立的（ownerTeam 由發布者自由填寫，未必等於自己
     *      隸屬的 team，只比對 teamIds 會漏掉自己剛建立的技能）
     *   2. 技能屬於自己的 team
     *   3. 自己是該 team scope 的 maintainer（未必隸屬該 team）
     *
     * 刻意不收錄「自己發布過版本」的技能：幫別的 team 發一版不等於那是
     * 自己的技能，會與「不列出其他 team 的套件」互相矛盾。
     */
    const inTeamScope = (aggregate: CatalogAggregate): boolean => {
      if (isMine(aggregate)) return true;
      const ownerTeam = aggregate.package.ownerTeam;
      if (identity.teamIds.includes(ownerTeam)) return true;
      /*
       * 刻意不用 hasRole：它對 global scope 一律回真，全域 maintainer
       * 會因此在 team 範圍拿到整個平台的技能。這裡只認真正綁在該 team
       * 上的授予。
       */
      return teamScopedMaintainerTeams.has(ownerTeam);
    };

    const inScope = (aggregate: CatalogAggregate): boolean => {
      if (scope === 'all') return true;
      if (scope === 'mine') return isMine(aggregate);
      return inTeamScope(aggregate);
    };

    const aggregates = await this.repository.listAggregates();
    const items: MaintainedPackageSummary[] = [];
    for (const aggregate of aggregates) {
      // 已封存的套件不能再建立版本，列出來只會造成誤點。
      if (aggregate.package.lifecycle !== 'active') continue;
      if (!inScope(aggregate)) continue;
      const sorted = [...aggregate.versions].sort(versionDescending);
      const latest = sorted[0];
      items.push({
        ...aggregate.package,
        ...(latest ? { latestVersion: latest } : {}),
        hasPublishedVersion: sorted.some((version) => version.lifecycle === 'published'),
        versionCount: sorted.length
      });
    }

    // 最近更新在前：剛建立或剛編輯過的技能通常就是接下來要處理的。
    items.sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        left.packageId.localeCompare(right.packageId)
    );

    /*
     * 分頁在權限過濾之後做。收錄條件同時取決於 createdByUid、隸屬團隊與
     * team scope 的 maintainer 授予，無法化為單一 SQL 游標，因此資料庫層
     * 拿不到正確的「第 N 頁」。維護清單是個人視角的集合，量級遠小於技能池，
     * 在記憶體切片可接受。
     *
     * 游標就是列在排序後陣列中的位置：資料在兩次請求之間變動時，最多是
     * 邊界上的一筆重複或略過，對這個場景可以接受。
     */
    const offset = Number.parseInt(filters.cursor ?? '', 10);
    const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
    const pageItems = items.slice(start, start + MAINTAINED_PAGE_SIZE);
    const nextOffset = start + pageItems.length;

    return {
      items: pageItems,
      canIncludeAllTeams,
      scope,
      ...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
      totalCount: items.length,
      state: items.length === 0 ? 'empty' : 'success'
    };
  }

  async getDetail(
    packageId: string,
    identity: ResolvedIdentity
  ): Promise<CatalogDetail> {
    const aggregate = await this.requireVisiblePackage(packageId, identity);
    let canSeePending = false;
    if (identity.kind === 'authenticated') {
      const isAuthor = aggregate.versions.some(
        (version) => version.authorUid === identity.uid
      );
      canSeePending =
        isAuthor || (await this.authorization.canReview(identity.uid, packageId));
    }
    const versions = aggregate.versions
      .filter(
        (version) =>
          version.lifecycle === 'published' ||
          (canSeePending && version.lifecycle === 'review_required')
      )
      .sort(versionDescending);
    return { ...aggregate.package, versions, adoption: aggregate.adoption };
  }

  /**
   * 兩個版本之間的升級差異。只比較呼叫者本來就看得到的版本，
   * 避免藉由差異端點推測未發布內容。
   */
  async getVersionDiff(
    packageId: string,
    currentVersion: string,
    targetVersion: string,
    identity: ResolvedIdentity
  ): Promise<VersionDiff> {
    const detail = await this.getDetail(packageId, identity);
    const current = detail.versions.find(
      (candidate) => candidate.version === currentVersion
    );
    const target = detail.versions.find(
      (candidate) => candidate.version === targetVersion
    );
    if (!current || !target) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_VERSION_NOT_FOUND',
        message: '找不到可比較的套件版本'
      });
    }
    return calculateVersionDiff(
      packageId,
      current,
      target,
      compareSemanticVersions
    );
  }

  async getDownload(
    packageId: string,
    version: string,
    identity: ResolvedIdentity
  ): Promise<PackageDownload> {
    const aggregate = await this.requireVisiblePackage(packageId, identity);
    const published = aggregate.versions.find(
      (candidate) =>
        candidate.version === version && candidate.lifecycle === 'published'
    );
    if (!published) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_VERSION_NOT_FOUND',
        message: '找不到可下載的套件版本'
      });
    }
    return {
      packageId,
      version,
      sourceUri: aggregate.package.sourceUri,
      ...(published.scriptDigest ? { scriptDigest: published.scriptDigest } : {}),
      installCommand: published.installCommand,
      uninstallCommand: published.uninstallCommand,
      hasResidualEffects: published.hasResidualEffects,
      ...(published.residualDescription
        ? { residualDescription: published.residualDescription }
        : {}),
      ...(published.manualCleanupSteps
        ? { manualCleanupSteps: published.manualCleanupSteps }
        : {})
    };
  }

  private async requireVisiblePackage(
    packageId: string,
    identity: ResolvedIdentity
  ): Promise<CatalogAggregate> {
    const aggregate = await this.repository.findAggregate(packageId);
    if (!aggregate || !canBrowsePackage(aggregate, identity)) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_NOT_FOUND',
        message: '找不到可存取的套件'
      });
    }
    return aggregate;
  }

  private async requireExistingPackage(packageId: string): Promise<CatalogAggregate> {
    const aggregate = await this.repository.findAggregate(packageId);
    if (!aggregate) throw this.packageNotFound();
    return aggregate;
  }

  private packageNotFound(): AppError {
    return new AppError({ statusCode: 404, code: 'PACKAGE_NOT_FOUND', message: '找不到套件' });
  }

  private async requireMutableVersion(
    packageId: string,
    version: string,
    identity: ResolvedIdentity,
    requireDraft = true
  ): Promise<{ current: PackageVersionRecord; uid: string }> {
    const aggregate = await this.requireExistingPackage(packageId);
    const uid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    const current = aggregate.versions.find((candidate) => candidate.version === version);
    if (!current) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    if (requireDraft && current.lifecycle !== 'draft') {
      throw new AppError({
        statusCode: 409,
        code: 'INVALID_VERSION_TRANSITION',
        message: '只有草稿版本可以修改腳本目標'
      });
    }
    return { current, uid };
  }

  private mapScriptValidationError(error: unknown): unknown {
    if (error instanceof Error && error.message.startsWith('INVALID_SCRIPT_OPTIONS:')) {
      return new AppError({ statusCode: 400, code: 'INVALID_SCRIPT_OPTIONS', message: '腳本選項格式錯誤' });
    }
    if (error instanceof Error && error.message.startsWith('INVALID_SCRIPT_TARGET_REVISION:')) {
      return new AppError({ statusCode: 400, code: 'INVALID_SCRIPT_TARGET_REVISION', message: '腳本內容格式錯誤' });
    }
    return error;
  }

  private async requireMaintainer(
    identity: ResolvedIdentity,
    ownerTeam: string
  ): Promise<string> {
    if (identity.kind !== 'authenticated') {
      throw new AppError({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED', message: '請先登入' });
    }
    /*
     * 四條路徑，任一成立即可維護：
     *   1. 平台管理員
     *   2. 全域 maintainer——可跨團隊更新所有技能
     *   3. 該團隊的 maintainer
     *   4. 該團隊的一般員工——技能是團隊資產，同團隊即可維護
     *
     * 第 4 條讓沒有任何角色的員工也能發布與更新自己團隊的技能。
     * 綁團隊而非綁建立者：人會離職換組，綁個人會讓技能失去維護者，
     * 且 packages 表本來就沒有建立者欄位，只有 ownerTeam。
     */
    if (identity.teamIds.includes(ownerTeam)) {
      return identity.uid;
    }
    const isAdmin = await this.authorization.hasRole(identity.uid, 'platform_admin', { type: 'global' });
    const isGlobalMaintainer = await this.authorization.hasRole(identity.uid, 'maintainer', { type: 'global' });
    if (!isAdmin && !isGlobalMaintainer) {
      throw new AppError({ statusCode: 403, code: 'FORBIDDEN', message: '沒有維護此套件的權限' });
    }
    return identity.uid;
  }
}

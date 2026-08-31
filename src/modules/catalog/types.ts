// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

export type PackageType = 'skill' | 'tool';
export type PackageVisibility = 'public' | 'internal';
export type PackageLifecycle = 'active' | 'archived';

/** 技能來自公開開源專案，或由內部自行開發 */
export const packageSourceValues = ['opensource', 'custom'] as const;
export type PackageSource = (typeof packageSourceValues)[number];

/** 發布者是個人還是組織，決定維護責任的歸屬 */
export const publisherKindValues = ['individual', 'organization'] as const;
export type PublisherKind = (typeof publisherKindValues)[number];

/**
 * 受約束的分類。舊的自由文字 category 保留為 legacy 顯示標籤，
 * 篩選一律走此列舉，見 0014 migration 的說明。
 */
export const packageCategoryCodeValues = [
  'frontend',
  'backend',
  'data',
  'testing',
  'devops',
  'security',
  'product_design',
  'general'
] as const;
export type PackageCategoryCode = (typeof packageCategoryCodeValues)[number];

/**
 * 技能分級。basic 為上架預設值，其餘一律由審核人核定，
 * 發布者不能自評，否則列表上的「精品」等同自封。
 */
export const packageGradeValues = [
  'basic',
  'premium',
  'general',
  'company_wide',
  'open_sourced'
] as const;
export type PackageGrade = (typeof packageGradeValues)[number];
export type VersionLifecycle =
  | 'draft'
  | 'validating'
  | 'validation_failed'
  | 'review_required'
  | 'published'
  | 'deprecated'
  | 'delisted'
  | 'emergency_disabled';

/**
 * 腳本目標的作業系統詞彙。以 const 陣列而非裸型別宣告，
 * 讓前端對照表與 API schema 能在測試中比對同一份來源。
 */
export const scriptTargetOsValues = ['linux/macos', 'windows', 'wsl'] as const;

export type ScriptTargetOs = (typeof scriptTargetOsValues)[number];
export type ClientRuntime = 'claude-code' | 'codex';
export type ScriptOptionType = 'select' | 'boolean' | 'text';

export interface ScriptOptionDefinition {
  name: string;
  type: ScriptOptionType;
  description: string;
  defaultValue: string | boolean;
  choices?: string[];
}

export interface ScriptCopySource {
  targetId: string;
  targetOs: ScriptTargetOs;
  clientRuntime: ClientRuntime;
  scriptVersion: number;
}

export interface ScriptTargetRevision {
  id: string;
  targetId: string;
  targetOs: ScriptTargetOs;
  clientRuntime: ClientRuntime;
  scriptVersion: number;
  installCommand: string;
  uninstallCommand: string;
  options: ScriptOptionDefinition[];
  usageInstructions: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
  changeDescription?: string;
  copiedFrom?: ScriptCopySource;
  contentDigest: string;
  legacyImported: boolean;
  createdByUid: string;
  createdAt: Date;
}

export interface ScriptTargetRecord {
  id: string;
  packageId: string;
  packageVersion: string;
  targetOs: ScriptTargetOs;
  clientRuntime: ClientRuntime;
  currentRevision?: ScriptTargetRevision;
  revisions: ScriptTargetRevision[];
  deletedAt?: Date;
  deletedByUid?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScriptTargetLocator {
  id: string;
  targetOs: ScriptTargetOs;
  clientRuntime: ClientRuntime;
}

export interface ScriptTargetRevisionContent {
  installCommand: string;
  uninstallCommand: string;
  options: ScriptOptionDefinition[];
  usageInstructions: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
  changeDescription?: string;
}

export interface CreateScriptTargetInput {
  targetOs: ScriptTargetOs;
  clientRuntime: ClientRuntime;
}

export interface SaveScriptTargetRevisionInput
  extends ScriptTargetRevisionContent {
  expectedScriptVersion: number;
}

export interface CopyScriptTargetRevisionInput {
  sourceTargetId: string;
  expectedScriptVersion: number;
  changeDescription?: string;
}

export interface ClientSupport {
  /** 顯示名稱，例如 Claude Code */
  name: string;
  /**
   * 腳本生成端點使用的識別碼，例如 claude-code。
   * 由 script target 導出時提供；相容期的舊資料沒有 target 因此可能缺值。
   * 前端送出請求時必須用此值而非 name，兩者不同名。
   */
  clientRuntime?: string;
  version?: string;
  adaptationSource: 'publisher' | 'maintainer' | 'community';
  maintainer: string;
}

export interface PackageRecord {
  packageId: string;
  type: PackageType;
  name: string;
  purpose: string;
  ownerTeam: string;
  /** legacy 自由文字分類，只作顯示；篩選請用 categoryCode */
  category: string;
  categoryCode: PackageCategoryCode;
  visibility: PackageVisibility;
  sourceUri: string;
  license: string;
  source: PackageSource;
  publisher: { kind: PublisherKind; name: string };
  grade: PackageGrade;
  /** 分級的核定者與時間；從未核定過（仍為預設 basic）時缺席 */
  gradeDecidedByUid?: string;
  gradeDecidedAt?: Date;
  /**
   * 建立者。不參與授權判斷，只用於「我的技能」的預設收錄。
   * 補上此欄位之前建立、且從未發布過版本的舊資料會缺席。
   */
  createdByUid?: string;
  lifecycle: PackageLifecycle;
  createdAt: Date;
  updatedAt: Date;
}

export interface PackageVersionRecord {
  id: string;
  packageId: string;
  version: string;
  releaseNotes?: string;
  supportedOs: string[];
  supportedClients: ClientSupport[];
  lifecycle: VersionLifecycle;
  scriptDigest?: string;
  scriptManifestDigest?: string;
  publishedAt?: Date;
  installCommand: string;
  uninstallCommand: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
  scriptTargets?: ScriptTargetRecord[];
  authorUid: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogAggregate {
  package: PackageRecord;
  versions: PackageVersionRecord[];
  adoption: AdoptionSummary;
}

export interface AdoptionSummary {
  installations: number;
  succeeded: number;
  successRate: number | null;
}

export interface CatalogSearchFilters {
  keyword?: string;
  /** legacy 自由文字分類的精確比對，保留給既有呼叫端 */
  category?: string;
  categoryCode?: PackageCategoryCode;
  grade?: PackageGrade;
  source?: PackageSource;
  client?: string;
  os?: string;
  cursor?: string;
  limit?: number;
  sort?: 'name_asc' | 'name_desc' | 'updated_desc';
}

export interface CatalogSummary extends PackageRecord {
  latestVersion: PackageVersionRecord;
}

export interface CatalogSearchResult {
  items: CatalogSummary[];
  nextCursor?: string;
  state: 'empty' | 'success';
}

export interface CatalogDetail extends PackageRecord {
  versions: PackageVersionRecord[];
  adoption: AdoptionSummary;
}

/**
 * 維護清單的一列。
 *
 * 與 CatalogSummary 的關鍵差異：latestVersion 可以缺席。
 * 技能池只列出有已發布版本的套件，維護者卻必須看到還沒發布過任何版本的
 * 技能，否則建立後就再也找不到入口回去填寫第一個版本。
 */
export interface MaintainedPackageSummary extends PackageRecord {
  /** 依語意版本排序後的最新版本；從未建立過版本時缺席 */
  latestVersion?: PackageVersionRecord;
  /** 是否已有任何 published 版本，決定列表顯示「更新版本」或「繼續編輯」 */
  hasPublishedVersion: boolean;
  versionCount: number;
}

/**
 * 維護清單的範圍，三者逐層擴大：mine ⊂ team ⊂ all。
 *
 * - mine：自己建立的技能
 * - team：自己所屬團隊，或自己有 team scope maintainer 的技能（含 mine）
 * - all：平台上全部技能，僅 platform_admin 或全域 maintainer 可用
 */
export const maintainedScopeValues = ['mine', 'team', 'all'] as const;
export type MaintainedScope = (typeof maintainedScopeValues)[number];

export interface MaintainedPackageFilters {
  /** 預設 team，與 includeAllTeams 之前的預設行為一致 */
  scope?: MaintainedScope;
  /**
   * @deprecated 改用 scope: 'all'。保留是為了不破壞既有呼叫端；
   * 兩者同時出現時以 scope 為準。
   */
  includeAllTeams?: boolean;
  /** 分頁游標，值為排序後清單中的起始位置 */
  cursor?: string;
}

export interface MaintainedPackageResult {
  items: MaintainedPackageSummary[];
  /** 下一頁游標；沒有更多資料時缺席 */
  nextCursor?: string;
  /** 過濾後的總筆數，供前端顯示「共 N 個技能」 */
  totalCount: number;
  /** 呼叫者是否有權使用 scope: 'all'，供前端決定是否顯示「所有技能」 */
  canIncludeAllTeams: boolean;
  /** 實際套用的範圍。無權使用 'all' 時退回 'team'，前端據此校正選中的 tab */
  scope: MaintainedScope;
  state: 'empty' | 'success';
}

export type CatalogPageState<T> =
  | { state: 'loading' }
  | { state: 'empty'; message: string }
  | { state: 'error'; message: string; retryable: boolean }
  | { state: 'partial'; data: T; unavailableSections: string[] }
  | { state: 'success'; data: T };

export interface PackageDownload {
  packageId: string;
  version: string;
  sourceUri: string;
  scriptDigest?: string;
  installCommand: string;
  uninstallCommand: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
}

/**
 * 建立技能的輸入。不含 grade：分級一律由審核人核定，
 * 新技能從預設的 basic 開始，發布者無法自評。
 */
export type CreatePackageInput = Omit<
  PackageRecord,
  | 'lifecycle'
  | 'createdAt'
  | 'updatedAt'
  | 'grade'
  | 'gradeDecidedByUid'
  | 'gradeDecidedAt'
  // 由伺服器取自 session，不接受客戶端指定
  | 'createdByUid'
  | 'publisher'
> & {
  /*
   * 發布者資訊由 ownerTeam 推導，一般不需傳入。技能屬團隊資產，
   * 團隊名就是發布者名；讓前端再填一次只會產生兩份可能不一致的資料。
   */
  publisher?: { kind: PublisherKind; name: string };
};

/**
 * service 補齊 publisher 之後傳給 repository 的輸入。
 * repository 不再需要處理「發布者從哪來」，一律拿到完整值。
 */
export type ResolvedCreatePackageInput = CreatePackageInput & {
  publisher: { kind: PublisherKind; name: string };
};

/** 維護者可改的欄位。grade 同樣不在其中，見 SetPackageGradeInput */
export type UpdatePackageInput = Partial<
  Pick<
    PackageRecord,
    | 'name'
    | 'purpose'
    | 'ownerTeam'
    | 'category'
    | 'categoryCode'
    | 'visibility'
    | 'sourceUri'
    | 'license'
    | 'source'
    | 'publisher'
  >
>;

/** 審核人核定分級。與審核決議分開：改分級是常態操作，不需重新送審 */
export interface SetPackageGradeInput {
  grade: PackageGrade;
}

export type CreatePackageVersionInput = Pick<
  PackageVersionRecord,
  'version' | 'releaseNotes'
>;

export type UpdatePackageVersionInput = Partial<
  Pick<PackageVersionRecord, 'releaseNotes' | 'scriptDigest'>
>;

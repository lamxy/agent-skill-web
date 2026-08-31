// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

/*
 * 前端使用的型別。刻意與後端 src/modules/catalog/types.ts 保持一致，
 * 但不跨目錄 import：後端走 NodeNext 解析、前端走 bundler 解析，
 * 兩套 tsconfig 混用會產生解析衝突。欄位變更時兩處同步更新。
 */

export type PackageType = 'skill' | 'tool';
export type PackageVisibility = 'public' | 'internal';

/** 技能來自公開開源專案，或由內部自行開發 */
export type PackageSource = 'opensource' | 'custom';

/** 發布者是個人還是組織，決定維護責任的歸屬 */
export type PublisherKind = 'individual' | 'organization';

export interface PackagePublisher {
  kind: PublisherKind;
  name: string;
}

/**
 * 受約束的分類。舊的自由文字 category 仍在回應中，但只作顯示：
 * 實際資料同時存在 backend 與 後端，篩選一律走此列舉。
 */
export type PackageCategoryCode =
  | 'frontend'
  | 'backend'
  | 'data'
  | 'testing'
  | 'devops'
  | 'security'
  | 'product_design'
  | 'general';

/** 技能分級。basic 為預設值，其餘由審核人核定，發布者不能自評 */
export type PackageGrade =
  | 'basic'
  | 'premium'
  | 'general'
  | 'company_wide'
  | 'open_sourced';

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
 * 安裝目標作業系統。Linux 與 macOS 的安裝命令多數可共用，
 * 已收斂為單一目標；後端 ScriptTargetOs 尚待同步擴充，見待決策 D-3。
 */
export type TargetOs = 'linux/macos' | 'windows' | 'wsl';
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
  targetOs: TargetOs;
  clientRuntime: ClientRuntime;
  scriptVersion: number;
}

export interface ScriptTargetRevision {
  id: string;
  targetId: string;
  targetOs: TargetOs;
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
  createdAt: string;
}

export interface ScriptTargetRecord {
  id: string;
  packageId: string;
  packageVersion: string;
  targetOs: TargetOs;
  clientRuntime: ClientRuntime;
  currentRevision?: ScriptTargetRevision | undefined;
  revisions: ScriptTargetRevision[];
  deletedAt?: string;
  deletedByUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScriptTargetInput {
  targetOs: TargetOs;
  clientRuntime: ClientRuntime;
}

export interface SaveScriptTargetRevisionInput {
  expectedScriptVersion: number;
  installCommand: string;
  uninstallCommand: string;
  options: ScriptOptionDefinition[];
  usageInstructions: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
  changeDescription?: string;
}

export interface CopyScriptTargetRevisionInput {
  sourceTargetId: string;
  expectedScriptVersion: number;
  changeDescription?: string;
}

export interface ClientSupport {
  /** 只記名稱不含版本號，版本相容性由發布者在使用說明中描述 */
  name: string;
  /**
   * 腳本生成端點接受的識別碼（claude-code），與顯示名稱（Claude Code）
   * 不同。呼叫 API 時必須送此值；相容期舊資料可能缺值。
   */
  clientRuntime?: string;
  adaptationSource: 'publisher' | 'maintainer' | 'community';
  maintainer: string;
}

export interface AdoptionSummary {
  installations: number;
  succeeded: number;
  /** 沒有數據時為 null，介面顯示「尚無數據」，不得顯示 0% */
  successRate: number | null;
}

export interface PackageVersionSummary {
  id: string;
  packageId: string;
  version: string;
  releaseNotes?: string;
  supportedOs: string[];
  supportedClients: ClientSupport[];
  lifecycle: VersionLifecycle;
  scriptDigest?: string;
  scriptManifestDigest?: string;
  publishedAt?: string;
  installCommand: string;
  uninstallCommand: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
  scriptTargets?: ScriptTargetRecord[];
  authorUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePackageVersionInput {
  version: string;
  releaseNotes?: string;
}

export type PublicationReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'superseded';

/**
 * 送審當下的技能快照。是歷史值，不隨技能後續變更而更新——
 * 需要當前值（例如分級核定）時必須另外讀取技能本身。
 */
export type ReviewPackageSnapshot = PackageRecordSummary;

export interface PublicationReview {
  id: string;
  packageId: string;
  version: string;
  packageType: PackageType;
  category: string;
  ownerTeam: string;
  authorUid: string;
  packageSnapshot: ReviewPackageSnapshot;
  versionSnapshot: PackageVersionSummary;
  validationRunId: string;
  reviewerUid?: string;
  status: PublicationReviewStatus;
  decisionReason?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface ValidationMatrixTarget {
  os: string;
  client: string;
}

export interface ValidationMatrixResult {
  os: string;
  client: string;
  runnerName: string;
  runnerVersion: string;
  scriptDigest: string;
  startedAt: string;
  endedAt: string;
  installExitCode?: number;
  telemetrySeen?: boolean;
  uninstallExitCode?: number;
  cleanupSucceeded: boolean;
  status: 'passed' | 'failed' | 'not_supported';
  errorCode?: string;
}

export interface ValidationAttempt {
  attempt: number;
  kind: 'initial' | 'retry';
  status: 'running' | 'abandoned' | 'passed' | 'failed' | 'skipped';
  requestedByUid: string;
  startedAt: string;
  endedAt?: string;
  runnerVersion?: string;
  matrixResults: ValidationMatrixResult[];
  errorCode?: string;
}

export interface ReviewWorkbench {
  review: PublicationReview;
  package: ReviewPackageSnapshot;
  version: PackageVersionSummary;
  validation: {
    id: string;
    status: 'running' | 'passed' | 'failed' | 'skipped';
    runnerVersion: string;
    scriptDigest: string;
    expectedMatrix: ValidationMatrixTarget[];
    matrixResults: ValidationMatrixResult[];
    attempts: ValidationAttempt[];
    startedAt: string;
    endedAt?: string;
    errorCode?: string;
  };
}

export interface ReviewFilters {
  status: PublicationReviewStatus;
  os?: string;
  client?: string;
  cursor?: string;
}

export interface ReviewSearchResult {
  items: ReviewWorkbench[];
  nextCursor?: string;
  state: 'empty' | 'success';
}

export interface ReviewDecisionResult {
  version: PackageVersionSummary;
  review: PublicationReview;
}

/**
 * 技能本身的欄位，對應後端 PackageRecord。
 * 列表、維護清單與詳情三者都在此基礎上各自擴充。
 */
export interface PackageRecordSummary {
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
  publisher: PackagePublisher;
  grade: PackageGrade;
  lifecycle: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

/**
 * 搜尋結果的單筆項目。對應後端 CatalogSummary：
 * PackageRecord 攤平後加上 latestVersion。
 *
 * 注意此型別不含 adoption：採用數據只在詳情端點回傳，
 * 列表頁不得渲染成功率一類欄位。
 */
export interface PackageSummary extends PackageRecordSummary {
  latestVersion: PackageVersionSummary;
}

/**
 * 維護清單的一列。latestVersion 可以缺席：剛建立、還沒有任何版本的
 * 技能必須出現在清單上，否則使用者找不到入口回來填寫第一個版本。
 */
export interface MaintainedPackage extends PackageRecordSummary {
  latestVersion?: PackageVersionSummary;
  hasPublishedVersion: boolean;
  versionCount: number;
}

/**
 * 維護清單的範圍，三者逐層擴大：mine ⊂ team ⊂ all。
 * 對應頁面上的「我的技能／團隊技能／所有技能」三個 tab。
 */
export type MaintainedScope = 'mine' | 'team' | 'all';

export interface MaintainedPackageResult {
  items: MaintainedPackage[];
  /** 下一頁游標；沒有更多資料時缺席 */
  nextCursor?: string;
  /** 過濾後的總筆數 */
  totalCount: number;
  /** 呼叫者是否有權使用 all，由伺服器判斷；決定是否顯示「所有技能」 */
  canIncludeAllTeams: boolean;
  /** 實際套用的範圍。無權使用 all 時伺服器會退回 team */
  scope: MaintainedScope;
  state: 'empty' | 'success';
}

/**
 * 建立新技能。所有欄位必填，對齊後端 POST /api/packages 的 schema。
 * 不含 grade：分級一律由審核人核定，見 setPackageGrade。
 */
export interface CreatePackageInput {
  packageId: string;
  type: PackageType;
  name: string;
  purpose: string;
  ownerTeam: string;
  category: string;
  categoryCode: PackageCategoryCode;
  visibility: PackageVisibility;
  sourceUri: string;
  license: string;
  source: PackageSource;
  /* 省略時由後端從 ownerTeam 推導；技能屬團隊資產，發布者即所屬團隊 */
  publisher?: PackagePublisher;
}

/**
 * 詳情回傳。對應後端 CatalogDetail 加上端點外層補的 state 欄位。
 * versions 只含 published；作者與審核者另可看到 review_required。
 */
export interface PackageDetail extends PackageRecordSummary {
  state: 'success';
  versions: PackageVersionSummary[];
  adoption: AdoptionSummary;
}

/** 生成腳本的請求目標。後端 targetOs 目前只接受 linux 與 windows，見待決策 D-3 */
export interface ScriptTarget {
  targetOs: string;
  clientRuntime: string;
}

export type ScriptAction = 'install' | 'uninstall';

export interface GeneratedScript {
  packageId: string;
  version: string;
  targetOs: string;
  action: 'install' | 'uninstall';
  clientRuntime: string;
  telemetryAssurance: 'best-effort';
  script: string;
  digest: string;
  preview: {
    installCommand: string;
    uninstallCommand: string;
    hasResidualEffects: boolean;
    residualDescription?: string;
    manualCleanupSteps?: string;
    telemetryFields: string[];
  };
}

export interface ReviewerAssignment {
  id: string;
  reviewerUid: string;
  packageType: string;
  category: string;
  assignedByUid: string;
  active: boolean;
  createdAt: string;
  revokedAt?: string;
  revokedByUid?: string;
}

export interface ReviewerAssignmentInput {
  reviewerUid: string;
  packageType: string;
  category: string;
}

export interface ReviewerAssignmentPage {
  items: ReviewerAssignment[];
}

export interface ReviewerCandidate {
  uid: string;
  displayName: string;
  teamIds: string[];
}

export interface ReviewerCandidatePage {
  items: ReviewerCandidate[];
}

export type AuditTargetType = 'package' | 'version' | 'user' | 'role';

export interface AuditFilters {
  eventType?: string;
  actorUid?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface AuditLog {
  id: string;
  eventType: string;
  actorUid: string;
  targetType: AuditTargetType;
  targetId: string;
  action: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  occurredAt: string;
}

export interface AuditPage {
  items: AuditLog[];
  nextCursor?: string;
}

export interface MyInstallation {
  packageId: string;
  packageName: string;
  currentVersion: string;
  status: 'installed';
  availableVersion: string;
  upgradeAvailable: boolean;
}

export interface AnalyticsPeriod {
  start: string;
  end: string;
}

export type ScriptTargetChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface ScriptTargetDiffSide {
  scriptVersion: number;
  contentDigest: string;
  hasResidualEffects: boolean;
  optionNames: string[];
}

/**
 * 單一「系統 × Client」的差異。後端刻意不回傳命令全文，
 * 只有 digest 與變更旗標；要看完整腳本須經安裝頁。
 */
export interface ScriptTargetDiff {
  targetOs: TargetOs;
  clientRuntime: ClientRuntime;
  change: ScriptTargetChangeKind;
  installCommandChanged: boolean;
  uninstallCommandChanged: boolean;
  usageInstructionsChanged: boolean;
  residualEffectsChanged: boolean;
  addedOptions: ScriptOptionDefinition[];
  removedOptions: ScriptOptionDefinition[];
  changedOptions: Array<{
    name: string;
    current: ScriptOptionDefinition;
    target: ScriptOptionDefinition;
  }>;
  current?: ScriptTargetDiffSide;
  target?: ScriptTargetDiffSide;
}

export type ReapprovalReasonCode =
  | 'RESIDUAL_EFFECTS_INTRODUCED'
  | 'SCRIPT_TARGET_ADDED'
  | 'SCRIPT_TARGET_REMOVED'
  | 'INSTALL_COMMAND_CHANGED'
  | 'UNINSTALL_COMMAND_CHANGED'
  | 'SCRIPT_OPTIONS_CHANGED';

export interface ReapprovalReason {
  code: ReapprovalReasonCode;
  targetOs?: TargetOs;
  clientRuntime?: ClientRuntime;
  message: string;
}

export interface VersionDiff {
  packageId: string;
  currentVersion: string;
  targetVersion: string;
  direction: 'upgrade' | 'downgrade' | 'same';
  releaseNotes?: string;
  scriptTargets: ScriptTargetDiff[];
  residualEffects: {
    current: boolean;
    target: boolean;
    introduced: boolean;
  };
  requiresReapproval: boolean;
  reapprovalReasons: ReapprovalReason[];
}

export type SupportChannelType = 'im_group' | 'email' | 'ticket_system' | 'doc';

export interface SupportChannel {
  id: string;
  packageId: string;
  channelType: SupportChannelType;
  label: string;
  address: string;
  instructions?: string;
  displayOrder: number;
  updatedByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportChannelContent {
  channelType: SupportChannelType;
  label: string;
  address: string;
  instructions?: string;
  displayOrder: number;
}

export type FeedbackIssueCategory =
  | 'install_failure'
  | 'uninstall_failure'
  | 'documentation'
  | 'performance'
  | 'compatibility'
  | 'feature_request'
  | 'other';

export type FeedbackStatus = 'open' | 'acknowledged' | 'resolved';

export interface FeedbackRecord {
  id: string;
  packageId: string;
  version: string;
  authorRefType: 'uid' | 'uuid';
  authorRef: string;
  satisfaction: number;
  issueCategory: FeedbackIssueCategory;
  detail: string;
  needsHumanSupport: boolean;
  status: FeedbackStatus;
  createdAt: string;
}

export interface SubmitFeedbackInput {
  version: string;
  satisfaction: number;
  issueCategory: FeedbackIssueCategory;
  detail: string;
  needsHumanSupport: boolean;
}

/**
 * 滿意度是自願填寫的自我聲明，與遙測同屬 best-effort，
 * 樣本不代表全體使用者，介面必須標示參考性質。
 */
export interface FeedbackSummary {
  packageId: string;
  total: number;
  averageSatisfaction: number | null;
  satisfactionDistribution: Array<{ satisfaction: number; count: number }>;
  byCategory: Array<{ issueCategory: FeedbackIssueCategory; count: number }>;
  needsHumanSupport: number;
  openNeedsHumanSupport: number;
}

export type NotificationType =
  | 'version_delisted'
  | 'version_emergency_disabled'
  | 'version_published';

export interface UserNotification {
  id: string;
  recipientUid: string;
  notificationType: NotificationType;
  packageId: string;
  version: string;
  payload: Record<string, unknown>;
  status: 'unread' | 'read';
  createdAt: string;
  readAt?: string;
}

export interface NotificationPage {
  items: UserNotification[];
  nextCursor?: string;
  state: 'empty' | 'success';
}

export interface FunnelMetrics {
  downloads: number;
  installs: number;
  uninstalls: number;
  downloadToInstall: number | null;
  installToUninstall: number | null;
}

export interface SuccessRateMetrics {
  successes: number;
  total: number;
  rate: number | null;
  confidenceInterval: { lower: number; upper: number } | null;
}

export interface FailureCell {
  version: string;
  osType: string;
  errorCode: string;
  count: number;
}

export interface PackageAnalyticsReport {
  packageId: string;
  period: AnalyticsPeriod;
  funnel: FunnelMetrics;
  successRates: {
    uid: SuccessRateMetrics;
    uuid: SuccessRateMetrics;
  };
  failureCells: FailureCell[];
  failureDistribution: {
    byVersion: Array<{ version: string; count: number }>;
    byOs: Array<{ osType: string; count: number }>;
    byErrorCode: Array<{ errorCode: string; count: number }>;
    heatmap: FailureCell[];
  };
  timeToRunnable: {
    platform: TimeDistributionMetrics;
    employee: TimeDistributionMetrics & { approximate: true };
  };
  versionDistribution: Array<{ version: string; installations: number }>;
  upgradeCandidates: Array<{
    uid: string;
    currentVersion: string;
    availableVersion: string;
  }>;
  telemetryAssurance: 'best-effort';
  dataNotice: '數據僅供參考';
  dataGaps: Array<{
    code: 'MISSING_DOWNLOAD_EVENTS';
    missingCount: number;
    message: string;
  }>;
}

export interface TimeDistributionMetrics {
  sampleSize: number;
  medianMilliseconds: number | null;
  p90Milliseconds: number | null;
  p95Milliseconds: number | null;
}

export interface SearchFilters {
  keyword?: string;
  /** legacy 自由文字分類，保留給既有呼叫端；篩選器請用 categoryCode */
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

export interface SearchResult {
  items: PackageSummary[];
  nextCursor?: string;
  /** 後端只回傳 empty 或 success；其餘三態由查詢層映射 */
  state: 'empty' | 'success';
}

/**
 * 五種頁面狀態。語義定義見 docs/目錄頁狀態契約.md。
 *
 * 責任邊界：搜尋與詳情 API 只回傳 empty 或 success；
 * loading、error 與 partial 由查詢層依請求生命週期與部分失敗情形映射。
 */
export type PageState<T> =
  | { state: 'loading' }
  | { state: 'empty'; message: string }
  | { state: 'error'; message: string; retryable: boolean }
  | { state: 'partial'; data: T; unavailableSections: string[] }
  | { state: 'success'; data: T };

export type IdentityRoleName =
  | 'employee'
  | 'maintainer'
  | 'reviewer'
  | 'platform_admin';

export type IdentityRoleScopeType =
  | 'global'
  | 'team'
  | 'package_type'
  | 'category'
  | 'package';

export interface IdentityRole {
  role: IdentityRoleName;
  scopeType: IdentityRoleScopeType;
  scopeValue: string;
}

/**
 * 角色管理頁使用的完整角色指派。比 IdentityRole 多了稽核欄位——
 * /api/auth/me 只需知道有什麼角色，管理頁還要顯示誰在何時授予。
 */
export interface RoleAssignment extends IdentityRole {
  id: string;
  uid: string;
  assignedByUid: string;
  active: boolean;
  createdAt: string;
  revokedAt?: string;
}

export interface RoleAssignmentPage {
  items: RoleAssignment[];
}

/**
 * 可在介面授予的角色。platform_admin 不在此列：它只能由部署設定的
 * BOOTSTRAP_ADMIN_UID 產生，後端對授予與撤銷都回 403。
 */
export type GrantableRole = Extract<
  IdentityRoleName,
  'employee' | 'maintainer' | 'reviewer'
>;

export interface GrantRoleInput {
  uid: string;
  role: GrantableRole;
  scopeType: IdentityRoleScopeType;
  scopeValue?: string;
}

export interface RevokeRoleInput {
  uid: string;
  role: GrantableRole;
}

/**
 * /api/auth/me 的兩種形狀。匿名不是登入失敗，而是一等公民：
 * 可瀏覽技能池與詳情，只有需要身份的動作才受限。
 */
export type Viewer =
  | { kind: 'anonymous'; anonymousId: string }
  | {
      kind: 'authenticated';
      uid: string;
      displayName: string;
      teamIds: string[];
      roles: IdentityRole[];
    };

/** 平台自身的版本。未開放的版本仍會列出，只是不可選用 */
export interface PlatformVersion {
  version: string;
  isAvailable: boolean;
  isCurrent: boolean;
  note: string | null;
  releasedAt: string | null;
}

export interface PlatformVersionList {
  versions: PlatformVersion[];
  /** 預設載入的版本；清單全空時為 null */
  currentVersion: string | null;
}

/** 點選版本後的查詢結果，message 由後端統一措辭 */
export interface PlatformVersionAvailability {
  version: string;
  isAvailable: boolean;
  message: string;
  note: string | null;
  releasedAt: string | null;
}

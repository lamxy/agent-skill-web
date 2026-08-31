// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useParams } from 'react-router';

import {
  copyScriptTargetRevision,
  createPackageVersion,
  createScriptTarget,
  deleteScriptTarget,
  fetchMaintainedPackages,
  fetchPackageVersion,
  fetchScriptTargetRevisions,
  saveScriptTargetRevision,
  submitVersionReview
} from '../api/publish.js';
import type {
  ClientRuntime,
  ScriptOptionDefinition,
  ScriptTargetRecord,
  ScriptTargetRevision,
  TargetOs
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { useProvideFooterAction } from '../api/footer-action-context.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { MaintainIcon } from '../components/icons.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { Button, Chip } from '../components/primitives.js';
import {
  TARGET_MATRIX,
  applyTargetRecord,
  buildCopyRevisionPayload,
  buildCreateVersionPayload,
  buildSaveRevisionPayload,
  changeScriptOptionType,
  createLatestRequestGate,
  currentScriptVersion,
  hydratePublishSession,
  optionEnvironmentBinding,
  optionEditorRowKey,
  reviewReadiness,
  scriptFilenamePattern,
  sortRevisionHistory,
  targetDraftFromRecord,
  targetKey,
  targetMeta,
  targetRowPresentation,
  validateTargetDraft
} from './publish-model.js';
import type { PublishSession, TargetDraft, TargetKey } from './publish-model.js';
import './publish.css';

const TELEMETRY_FIELDS = [
  'idempotency_key', 'package_id', 'version', 'user_ref', 'user_ref_type',
  'os_type', 'client_runtime', 'status', 'error_code', 'start_time', 'end_time',
  'script_version', 'options'
] as const;

type TargetErrors = Partial<Record<keyof TargetDraft, string>>;
type RequestState = 'idle' | 'loading' | 'saving' | 'submitting';

function emptyDraft(): TargetDraft {
  return {
    expectedScriptVersion: 0,
    installCommand: '',
    uninstallCommand: '',
    options: [],
    usageInstructions: '',
    hasResidualEffects: false,
    residualDescription: '',
    manualCleanupSteps: '',
    changeDescription: ''
  };
}

function FieldError({ id, message }: { id: string; message: string | undefined }): ReactNode {
  return message ? <small id={id} className="pub-field-error">{message}</small> : null;
}

function updateUrl(packageId: string, version: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('packageId', packageId);
  url.searchParams.set('version', version);
  window.history.replaceState(null, '', url);
}

function queryDraft(): { packageId: string; version: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const packageId = params.get('packageId')?.trim();
  const version = params.get('version')?.trim();
  return packageId && version ? { packageId, version } : undefined;
}

function OptionEditor({
  options,
  onChange,
  disabled,
  error
}: {
  options: ScriptOptionDefinition[];
  onChange: (options: ScriptOptionDefinition[]) => void;
  disabled: boolean;
  error: string | undefined;
}): ReactNode {
  const update = (index: number, patch: Partial<ScriptOptionDefinition>) => {
    onChange(options.map((option, current) => current === index ? { ...option, ...patch } : option));
  };
  return (
    <section className="pub-panel" aria-labelledby="pub-options-title">
      <div className="pub-panel-head">
        <div><h2 id="pub-options-title">選項參數</h2><p>原樣傳給中部命令，並隨遙測上報。</p></div>
        <Button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...options, { name: '--option', type: 'text', description: '', defaultValue: '' }])}
        >＋ 新增參數</Button>
      </div>
      {options.length ? (
        <div className="pub-options" role="list" aria-label="腳本選項" aria-describedby={error ? 'pub-options-error' : undefined}>
          {options.map((option, index) => {
            const binding = optionEnvironmentBinding(option.name);
            return (
              <div className="pub-option-row" role="listitem" key={optionEditorRowKey(index)}>
                <label>參數名
                  <input value={option.name} disabled={disabled} aria-invalid={Boolean(error)} onChange={(event) => update(index, { name: event.target.value })} />
                </label>
                <label>類型
                  <Select value={option.type} disabled={disabled} ariaLabel="選項類型" onChange={(value) => onChange(options.map((item, current) => current === index ? changeScriptOptionType(item, value as ScriptOptionDefinition['type']) : item))} options={[{ value: 'select', label: '單選' }, { value: 'boolean', label: '開關' }, { value: 'text', label: '文字' }]} />
                </label>
                <label>說明
                  <input value={option.description} disabled={disabled} onChange={(event) => update(index, { description: event.target.value })} />
                </label>
                <label>預設值
                  {option.type === 'boolean' ? (
                    <Select value={String(option.defaultValue)} disabled={disabled} ariaLabel="預設值" onChange={(value) => update(index, { defaultValue: value === 'true' })} options={[{ value: 'false', label: 'false' }, { value: 'true', label: 'true' }]} />
                  ) : (
                    <input value={String(option.defaultValue)} disabled={disabled} onChange={(event) => update(index, { defaultValue: event.target.value })} />
                  )}
                </label>
                {option.type === 'select' ? (
                  <label>選項（逗號分隔）
                    <input value={option.choices?.join(', ') ?? ''} disabled={disabled} onChange={(event) => update(index, { choices: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
                  </label>
                ) : null}
                <code>{option.name || '--option'} → {binding.shellPreview}</code>
                <Button type="button" disabled={disabled} aria-label={`移除參數 ${option.name || index + 1}`} onClick={() => onChange(options.filter((_, current) => current !== index))}>移除</Button>
              </div>
            );
          })}
        </div>
      ) : <p className="pub-empty-note">尚未宣告選項；需要安裝層級或功能開關時再新增。</p>}
      <FieldError id="pub-options-error" message={error} />
      <p className="pub-command-rule">中部命令以 <strong>ASP_OPT_</strong> 前綴的環境變數讀取選項。</p>
    </section>
  );
}

export function PublishForm({
  packageId,
  packageName,
  isFirstVersion = false
}: {
  packageId: string;
  packageName: string;
  /**
   * 這個技能還沒有任何版本。剛建立完技能被導向到這裡的人屬於此情況，
   * 對他們說「更新版本」會像是走錯了頁面。
   */
  isFirstVersion?: boolean;
}): ReactNode {
  const packageDisplayName = packageName ? `${packageName}（${packageId}）` : packageId;
  const [version, setVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [session, setSession] = useState<PublishSession>();
  const [selectedKey, setSelectedKey] = useState<TargetKey>();
  const [draft, setDraft] = useState<TargetDraft>(emptyDraft);
  const [addOs, setAddOs] = useState<TargetOs>('linux/macos');
  const [addClient, setAddClient] = useState<ClientRuntime>('claude-code');
  const [copySourceId, setCopySourceId] = useState('');
  const [history, setHistory] = useState<ScriptTargetRevision[]>();
  const [historyTarget, setHistoryTarget] = useState<ScriptTargetRecord>();
  const [errors, setErrors] = useState<TargetErrors>({});
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [message, setMessage] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const requestGate = useRef(createLatestRequestGate()).current;

  const selectedTarget = selectedKey ? session?.targets[selectedKey] : undefined;
  const readiness = reviewReadiness(session?.targets ?? {});
  const availableTargets = TARGET_MATRIX.filter((item) => !session?.targets[item.key]);
  const copySources = Object.values(session?.targets ?? {}).filter(
    (target): target is ScriptTargetRecord => Boolean(target?.currentRevision && target.id !== selectedTarget?.id)
  );
  const copySource = copySources.find((target) => target.id === copySourceId);
  const editorDisabled = !selectedTarget || requestState !== 'idle';

  const startRequest = (state: Exclude<RequestState, 'idle'>): number => {
    const token = requestGate.begin();
    setRequestState(state);
    return token;
  };

  const finishRequest = (token: number): void => {
    if (requestGate.isCurrent(token)) setRequestState('idle');
  };

  const interruptPendingRequest = (): void => {
    requestGate.invalidate();
    setRequestState('idle');
  };

  const selectTarget = (target: ScriptTargetRecord, interrupt = true) => {
    if (interrupt) interruptPendingRequest();
    const key = targetKey(target.targetOs, target.clientRuntime);
    setSelectedKey(key);
    setDraft(targetDraftFromRecord(target));
    setErrors({});
    setCopySourceId('');
    setHistory(undefined);
    setHistoryTarget(undefined);
  };

  const replaceTarget = (target: ScriptTargetRecord, select = true) => {
    setSession((current) => current ? applyTargetRecord(current, target) : current);
    if (!target.deletedAt && select) selectTarget(target, false);
  };

  const loadVersion = useCallback(async (nextPackageId: string, nextVersion: string) => {
    const token = requestGate.begin();
    setRequestState('loading');
    setMessage('');
    try {
      const record = await fetchPackageVersion(nextPackageId, nextVersion);
      if (!requestGate.isCurrent(token)) return;
      const hydrated = hydratePublishSession(record);
      setVersion(record.version);
      setReleaseNotes(record.releaseNotes ?? '');
      setSession(hydrated);
      setSelectedKey(hydrated.selectedTarget);
      const target = hydrated.selectedTarget ? hydrated.targets[hydrated.selectedTarget] : undefined;
      setDraft(target ? targetDraftFromRecord(target) : emptyDraft());
      setErrors({});
      setCopySourceId('');
      setHistory(undefined);
      setHistoryTarget(undefined);
      setReviewSubmitted(record.lifecycle !== 'draft');
      setMessage(`草稿 ${record.version} 已從伺服器重新載入。`);
      updateUrl(record.packageId, record.version);
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? error.message : '草稿載入失敗。');
    } finally {
      if (requestGate.isCurrent(token)) setRequestState('idle');
    }
  }, [requestGate]);

  useEffect(() => {
    /*
     * 只在網址帶的草稿屬於當前技能時才載入。
     * 從別的技能的草稿網址切過來時，殘留的 version 會指向不存在的版本。
     */
    const initial = queryDraft();
    if (initial && initial.packageId === packageId) {
      void loadVersion(initial.packageId, initial.version);
    }
  }, [loadVersion, packageId]);

  const createVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!version.trim()) {
      setMessage('請填寫版本號。');
      return;
    }
    const token = startRequest('saving');
    setMessage('');
    try {
      const created = await createPackageVersion(packageId, buildCreateVersionPayload(version, releaseNotes));
      if (!requestGate.isCurrent(token)) return;
      const hydrated = hydratePublishSession(created);
      setSession(hydrated);
      setVersion(created.version);
      setSelectedKey(hydrated.selectedTarget);
      setDraft(emptyDraft());
      setErrors({});
      setHistory(undefined);
      setHistoryTarget(undefined);
      updateUrl(packageId, created.version);
      setMessage(`草稿 ${created.version} 已建立；可逐組保存腳本。`);
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? error.message : '版本草稿建立失敗。');
    } finally {
      finishRequest(token);
    }
  };

  const addTarget = async () => {
    if (!session) return;
    const token = startRequest('saving');
    setMessage('');
    try {
      const created = await createScriptTarget(session.packageId, session.packageVersion, { targetOs: addOs, clientRuntime: addClient });
      const current = requestGate.isCurrent(token);
      replaceTarget(created, current);
      if (current) setMessage(`${targetMeta(addOs, addClient).osLabel} · ${targetMeta(addOs, addClient).clientLabel} 已加入，請填寫命令。`);
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? error.message : '加入組合失敗。');
    } finally {
      finishRequest(token);
    }
  };

  const saveCurrent = async () => {
    if (!session || !selectedTarget) return;
    const nextErrors = validateTargetDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setMessage('請先修正目前組合的必填欄位。');
      return;
    }
    const token = startRequest('saving');
    setMessage('');
    try {
      const saved = await saveScriptTargetRevision(session.packageId, session.packageVersion, selectedTarget.id, buildSaveRevisionPayload(draft));
      const current = requestGate.isCurrent(token);
      replaceTarget(saved, current);
      if (current) setMessage(`${targetMeta(saved.targetOs, saved.clientRuntime).osLabel} · ${targetMeta(saved.targetOs, saved.clientRuntime).clientLabel} 已保存為 script v${saved.currentRevision?.scriptVersion ?? currentScriptVersion(saved)}。`);
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? `${error.message}；請重新載入權威草稿後再編輯。` : '腳本保存失敗。');
    } finally {
      finishRequest(token);
    }
  };

  const copyCurrent = async () => {
    if (!session || !selectedTarget || !copySource) return;
    const token = startRequest('saving');
    setMessage('');
    try {
      const copied = await copyScriptTargetRevision(
        session.packageId,
        session.packageVersion,
        selectedTarget.id,
        buildCopyRevisionPayload(copySource.id, selectedTarget, draft.changeDescription)
      );
      const current = requestGate.isCurrent(token);
      replaceTarget(copied, current);
      if (current) setMessage('跨組合複製已保存；後續手動保存會由伺服器清除來源標記。');
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? error.message : '複製命令失敗。');
    } finally {
      finishRequest(token);
    }
  };

  const showHistory = async (target: ScriptTargetRecord) => {
    if (!session) return;
    if (target.deletedAt) {
      interruptPendingRequest();
      setHistory(undefined);
      setHistoryTarget(target);
    } else {
      selectTarget(target);
      setHistoryTarget(target);
    }
    const token = startRequest('loading');
    try {
      const revisions = await fetchScriptTargetRevisions(session.packageId, session.packageVersion, target.id);
      if (requestGate.isCurrent(token)) setHistory(revisions);
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? error.message : '版本紀錄載入失敗。');
    } finally {
      finishRequest(token);
    }
  };

  const removeTarget = async (target: ScriptTargetRecord) => {
    if (!session) return;
    if (typeof window !== 'undefined' && !window.confirm('確定刪除此腳本組合？版本紀錄仍會保留。')) return;
    const token = startRequest('saving');
    try {
      const removed = await deleteScriptTarget(session.packageId, session.packageVersion, target.id, currentScriptVersion(target));
      setSession((current) => current ? applyTargetRecord(current, removed) : current);
      if (requestGate.isCurrent(token)) {
        if (selectedKey === targetKey(target.targetOs, target.clientRuntime)) {
          setSelectedKey(undefined);
          setDraft(emptyDraft());
          setErrors({});
        }
        setMessage('腳本組合已軟刪除；可從下方版本紀錄追溯，重新加入後會建立新版。');
      }
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? error.message : '刪除組合失敗。');
    } finally {
      finishRequest(token);
    }
  };

  const submitReview = async () => {
    if (!session || !readiness.canSubmit || reviewSubmitted) return;
    const token = startRequest('submitting');
    setMessage('');
    try {
      await submitVersionReview(session.packageId, session.packageVersion);
      if (requestGate.isCurrent(token)) {
        setReviewSubmitted(true);
        setMessage(`版本 ${session.packageVersion} 已送出審核。`);
      }
    } catch (error) {
      if (requestGate.isCurrent(token)) setMessage(error instanceof Error ? error.message : '送出審核失敗。');
    } finally {
      finishRequest(token);
    }
  };

  const sourcePreview = copySource?.currentRevision;
  const selectedMeta = selectedTarget ? targetMeta(selectedTarget.targetOs, selectedTarget.clientRuntime) : undefined;

  /*
   * 保存與送審交給全站頁腳的固定欄。送審條件的說明文字一併移過去，
   * 讓「為什麼還不能送審」與按鈕停留在同一處。
   */
  useProvideFooterAction(
    () => ({
      hint: (
        <span aria-live="polite" aria-atomic="true">
          <span id="pub-review-readiness">{readiness.message}</span>
          {message ? <span className="pub-message" role="status">{message}</span> : null}
        </span>
      ),
      content: (
        <>
          <Button
            type="button"
            disabled={!selectedTarget || requestState !== 'idle'}
            onClick={() => void saveCurrent()}
          >
            {requestState === 'saving' ? '保存中…' : '保存當前填寫的組合'}
          </Button>
          <Button
            type="button"
            variant="primary"
            ariaDescribedBy="pub-review-readiness"
            disabled={
              !session || !readiness.canSubmit || requestState !== 'idle' || reviewSubmitted
            }
            onClick={() => void submitReview()}
          >
            {requestState === 'submitting'
              ? '送審中…'
              : reviewSubmitted
                ? '已送出審核'
                : '送出審核'}
          </Button>
        </>
      )
    }),
    /*
     * saveCurrent 與 submitReview 每次 render 都是新的函式實例，放進相依
     * 陣列會讓投遞無限重跑；兩者透過閉包讀到的仍是當次 render 的 state，
     * 而所有會改變按鈕行為的值都已列在下方。
     */
    [
      readiness.message,
      readiness.canSubmit,
      message,
      selectedTarget,
      requestState,
      session,
      reviewSubmitted
    ]
  );

  return (
    <div className="pub">
      <Breadcrumb
        items={[
          { label: '我維護的技能', to: '/publish' },
          { label: packageDisplayName },
          { label: isFirstVersion ? '填寫第一個版本' : '更新技能版本' }
        ]}
      />
      <header className="pub-head">
        <h1>
          <MaintainIcon className="page-title-icon" />
          {isFirstVersion ? '填寫第一個版本' : '更新技能版本'}
        </h1>
        <p>
          {isFirstVersion
            ? '技能已建立，但還要有一個通過審核的版本才會出現在技能池。'
            : ''}
          為每個要支援的「系統 × Client」組合各填一份中部命令。Linux 與 macOS 已合併；命令可跨組合複製後調整。送審通過後新版本自動上架。
        </p>
      </header>

      <form className="pub-panel" onSubmit={createVersion} aria-labelledby="pub-basic-title">
        <div className="pub-panel-head"><div><h2 id="pub-basic-title">基本資料</h2><p>先建立版本容器，後續每個 target 都直接保存到伺服器。</p></div></div>
        <div className="pub-grid-two">
          <div><label htmlFor="pub-package">技能</label>
            {/* 技能由網址決定，不在此更換：換技能等於換一份草稿，應回清單重新進入 */}
            <input id="pub-package" name="packageId" value={packageDisplayName} readOnly aria-readonly="true" />
          </div>
          <div><label htmlFor="pub-version">{isFirstVersion ? '版本號' : '新版本號'}<span aria-hidden="true"> *</span></label>
            <input id="pub-version" name="version" required maxLength={100} value={version} disabled={Boolean(session)} onChange={(event) => setVersion(event.target.value)} placeholder="例如 3.2.1" />
          </div>
        </div>
        <label htmlFor="pub-release-notes">版本說明（選填）</label>
        <textarea id="pub-release-notes" name="releaseNotes" rows={3} maxLength={10000} value={releaseNotes} disabled={Boolean(session)} onChange={(event) => setReleaseNotes(event.target.value)} />
        <div className="pub-inline-action">
          <span>{session ? `伺服器草稿：${session.packageId} · ${session.packageVersion}` : '先建立版本草稿後即可逐組保存。'}</span>
          <Button type="submit" disabled={Boolean(session) || requestState !== 'idle'}>{session ? '版本草稿已建立' : '建立版本草稿'}</Button>
          {session ? <Button type="button" onClick={() => void loadVersion(session.packageId, session.packageVersion)}>重新載入</Button> : null}
        </div>
      </form>

      <section className="pub-panel" aria-labelledby="pub-matrix-title">
        <div className="pub-panel-head">
          <div><h2 id="pub-matrix-title">一鍵安裝腳本 Matrix</h2><p>{readiness.activeCount} 個已加入 · {readiness.pendingCount} 個待填寫</p></div>
          <Chip tone={readiness.canSubmit ? 'ok' : 'warn'}>{readiness.canSubmit ? '可送審' : '尚未完整'}</Chip>
        </div>
        <div className="pub-target-list">
          {TARGET_MATRIX.map((meta) => {
            const target = session?.targets[meta.key];
            const revision = target?.currentRevision;
            return (
              <article className={`pub-target-row${selectedKey === meta.key ? ' is-selected' : ''}`} key={meta.key}>
                <div>
                  <strong>{meta.osLabel} · {meta.clientLabel}</strong>
                  <span>{revision ? `${meta.language} · script v${revision.scriptVersion} · ${revision.options.length} 個選項` : '尚未加入或待填寫命令'}</span>
                  {target && revision ? <code>{scriptFilenamePattern(session!.packageId, session!.packageVersion, target)}</code> : null}
                  {revision?.copiedFrom ? <em>複製自 {targetMeta(revision.copiedFrom.targetOs, revision.copiedFrom.clientRuntime).osLabel} · {targetMeta(revision.copiedFrom.targetOs, revision.copiedFrom.clientRuntime).clientLabel} v{revision.copiedFrom.scriptVersion}</em> : null}
                </div>
                <div className="pub-row-actions">
                  <Button type="button" disabled={!target} onClick={() => target && selectTarget(target)}>{revision ? '編輯' : '填寫'}</Button>
                  <Button type="button" disabled={!target || !copySources.length} onClick={() => target && selectTarget(target)}>複製命令</Button>
                  <Button type="button" disabled={!target} onClick={() => target && void showHistory(target)}>版本紀錄</Button>
                  <Button type="button" disabled={!target} onClick={() => target && void removeTarget(target)}>刪除</Button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="pub-add-target">
          <label htmlFor="pub-add-os">作業系統</label>
          <Select id="pub-add-os" value={addOs} disabled={!session || !availableTargets.length} onChange={(value) => setAddOs(value as TargetOs)} options={[{ value: 'linux/macos', label: 'Linux / macOS' }, { value: 'windows', label: 'Windows' }, { value: 'wsl', label: 'WSL' }]} />
          <label htmlFor="pub-add-client">Client</label>
          <Select id="pub-add-client" value={addClient} disabled={!session || !availableTargets.length} onChange={(value) => setAddClient(value as ClientRuntime)} options={[{ value: 'claude-code', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} />
          <Button type="button" disabled={!session || Boolean(session.targets[targetKey(addOs, addClient)]) || requestState !== 'idle'} onClick={() => void addTarget()}>加入組合</Button>
        </div>
        <p className="pub-empty-note">刪除的腳本改為不可見，不會從紀錄中移除，仍可在版本紀錄中追溯。</p>
      </section>

      <section className="pub-panel" aria-labelledby="pub-command-title">
        <div className="pub-panel-head"><div><h2 id="pub-command-title">編輯中部命令</h2><p>{selectedMeta ? `${selectedMeta.osLabel} · ${selectedMeta.clientLabel} · ${selectedMeta.language} · 下一版 v${draft.expectedScriptVersion + 1}` : '先加入並選擇一個組合'}</p></div></div>
        <div className="pub-command-grid">
          <div>
            <label htmlFor="pub-install-command">安裝命令<span aria-hidden="true"> *</span></label>
            <textarea id="pub-install-command" name="installCommand" rows={12} maxLength={100000} value={draft.installCommand} disabled={!selectedTarget} aria-invalid={Boolean(errors.installCommand)} aria-describedby={errors.installCommand ? 'pub-install-error' : 'pub-command-rule'} onChange={(event) => setDraft({ ...draft, installCommand: event.target.value })} />
            <FieldError id="pub-install-error" message={errors.installCommand} />
          </div>
          <div>
            <label htmlFor="pub-uninstall-command">解除安裝命令<span aria-hidden="true"> *</span></label>
            <textarea id="pub-uninstall-command" name="uninstallCommand" rows={12} maxLength={100000} value={draft.uninstallCommand} disabled={!selectedTarget} aria-invalid={Boolean(errors.uninstallCommand)} aria-describedby={errors.uninstallCommand ? 'pub-uninstall-error' : 'pub-command-rule'} onChange={(event) => setDraft({ ...draft, uninstallCommand: event.target.value })} />
            <FieldError id="pub-uninstall-error" message={errors.uninstallCommand} />
          </div>
        </div>
        <p id="pub-command-rule" className="pub-command-rule">不要寫 shebang、不要自行回報結果、不要讀取使用者識別；平台會處理這三件事。</p>
        <label htmlFor="pub-change-description">本次變更描述（選填）</label>
        <input id="pub-change-description" value={draft.changeDescription} disabled={!selectedTarget} onChange={(event) => setDraft({ ...draft, changeDescription: event.target.value })} placeholder="例如：修正 macOS 上 tar 解壓路徑問題" />
        <div className="pub-copy-panel">
          <label htmlFor="pub-copy-source">跨組合複製來源</label>
          <Select id="pub-copy-source" value={copySourceId} disabled={!selectedTarget || !copySources.length} placeholder="選擇已保存的來源" onChange={setCopySourceId} options={copySources.map((source) => {
            const meta = targetMeta(source.targetOs, source.clientRuntime);
            return { value: source.id, label: `${meta.osLabel} · ${meta.clientLabel} · v${source.currentRevision?.scriptVersion}` };
          })} />
          {sourcePreview ? <pre aria-label="複製來源預覽">安裝：{sourcePreview.installCommand}\n解除安裝：{sourcePreview.uninstallCommand}</pre> : <p>選擇來源後先預覽，再確認保存獨立快照。</p>}
          <Button type="button" disabled={!copySource || requestState !== 'idle'} onClick={() => void copyCurrent()}>確認複製命令</Button>
        </div>
      </section>

      <OptionEditor options={draft.options} disabled={!selectedTarget} error={errors.options} onChange={(options) => setDraft({ ...draft, options })} />

      <section className="pub-panel" aria-labelledby="pub-usage-title">
        <div className="pub-panel-head"><div><h2 id="pub-usage-title">使用說明</h2><p>員工在詳情頁與 --help 看到的內容。</p></div></div>
        <label htmlFor="pub-usage">腳本使用說明<span aria-hidden="true"> *</span></label>
        <textarea id="pub-usage" name="usageInstructions" rows={6} value={draft.usageInstructions} disabled={!selectedTarget} aria-invalid={Boolean(errors.usageInstructions)} aria-describedby={errors.usageInstructions ? 'pub-usage-error' : 'pub-usage-help'} onChange={(event) => setDraft({ ...draft, usageInstructions: event.target.value })} />
        <small id="pub-usage-help">說明會顯示在詳情頁，並寫入腳本的 --help 輸出。</small>
        <FieldError id="pub-usage-error" message={errors.usageInstructions} />
      </section>

      <section className="pub-panel" aria-labelledby="pub-residual-title">
        <div className="pub-panel-head"><div><h2 id="pub-residual-title">殘留聲明</h2><p>解除安裝仍留內容時，兩項說明都必填。</p></div></div>
        <label className="pub-switch"><input type="checkbox" checked={draft.hasResidualEffects} disabled={!selectedTarget} onChange={(event) => setDraft({ ...draft, hasResidualEffects: event.target.checked })} /><span><strong>解除安裝後會留下內容</strong><small>員工會在詳情頁看到警示。</small></span></label>
        {draft.hasResidualEffects ? <div className="pub-grid-two">
          <div><label htmlFor="pub-residual">殘留內容說明</label><textarea id="pub-residual" value={draft.residualDescription} aria-invalid={Boolean(errors.residualDescription)} onChange={(event) => setDraft({ ...draft, residualDescription: event.target.value })} /><FieldError id="pub-residual-error" message={errors.residualDescription} /></div>
          <div><label htmlFor="pub-cleanup">手動清理步驟</label><textarea id="pub-cleanup" value={draft.manualCleanupSteps} aria-invalid={Boolean(errors.manualCleanupSteps)} onChange={(event) => setDraft({ ...draft, manualCleanupSteps: event.target.value })} /><FieldError id="pub-cleanup-error" message={errors.manualCleanupSteps} /></div>
        </div> : null}
      </section>

      {history ? <section className="pub-panel" aria-labelledby="pub-history-title">
        <div className="pub-panel-head"><div><h2 id="pub-history-title">版本紀錄</h2><p>由新到舊；軟刪除後仍可追溯。</p></div></div>
        <ol className="pub-history">{sortRevisionHistory(history).map((item) => <li key={item.id}><strong>script v{item.scriptVersion}</strong><span>{item.displayDescription}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-TW')}</time></li>)}</ol>
      </section> : null}

      <section className="pub-panel" aria-labelledby="pub-telemetry-title">
        <div className="pub-panel-head"><div><h2 id="pub-telemetry-title">尾部將回報的欄位</h2><p>固定十三欄；新增欄位以強調色標示。</p></div><a href="/privacy">查看隱私聲明</a></div>
        <ul className="pub-telemetry">{TELEMETRY_FIELDS.map((field) => <li className={field === 'script_version' || field === 'options' ? 'is-added' : ''} key={field}>{field}</li>)}</ul>
        <p className="pub-telemetry-note">不收集命令輸出、檔案內容或環境變數。</p>
      </section>
    </div>
  );
}

/**
 * 更新技能版本。技能由網址決定，不再由下拉選單挑選。
 *
 * 名稱取自維護清單而非技能池：尚無已發布版本的技能不會出現在技能池，
 * 用 searchPackages 查會拿不到名稱。
 */
export function PublishPage(): ReactNode {
  const { packageId = '' } = useParams<{ packageId: string }>();
  /*
   * 用最寬的範圍查：只是為了拿名稱與版本數，範圍窄了會查不到自己正在
   * 編輯的那一筆。伺服器對無權者會退回 team，不構成越權。
   */
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchMaintainedPackages({ scope: 'all' }, signal),
    []
  );
  const { pageState, reload } = usePageState(fetcher, []);

  return (
    <PageStateView pageState={pageState} onRetry={reload}>
      {(data) => {
        const found = data.items.find((item) => item.packageId === packageId);
        return (
          <PublishForm
            packageId={packageId}
            packageName={found?.name ?? ''}
            isFirstVersion={found ? found.versionCount === 0 : false}
          />
        );
      }}
    </PageStateView>
  );
}

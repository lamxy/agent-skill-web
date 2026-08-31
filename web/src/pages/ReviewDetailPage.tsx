// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router';

import { fetchPackageDetail, setPackageGrade } from '../api/catalog.js';
import { ApiError } from '../api/client.js';
import { decideReview, fetchReview } from '../api/reviews.js';
import type { ReviewDecision } from '../api/reviews.js';
import type {
  PackageGrade,
  PublicationReview,
  ReviewWorkbench,
  ScriptTargetRecord,
  ScriptTargetRevision,
  ValidationMatrixResult
} from '../api/types.js';
import { GRADE_LABEL, GRADE_TONE } from './catalog-taxonomy.js';
import { usePageState } from '../api/use-page-state.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { Button, Chip } from '../components/primitives.js';
import {
  buildReviewMatrixRows,
  nextReviewDecisionError,
  reviewDecisionError,
  reviewMutationRecovery,
  reviewStatusMeta,
  summarizeDecisionReadiness,
  summarizeReviewValidation
} from './reviews-model.js';
import './review-detail.css';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function exitCode(value: number | undefined): string {
  return value === undefined ? '—' : `exit ${value}`;
}

function resultLabel(result: ValidationMatrixResult | undefined): ReactNode {
  if (!result) return <span className="rd-missing">缺失</span>;
  if (result.status === 'passed') return <span className="rd-pass">通過</span>;
  if (result.status === 'not_supported') {
    return <span className="rd-warn">不支援</span>;
  }
  return <span className="rd-fail">失敗</span>;
}

function MatrixEvidence({ data }: { data: ReviewWorkbench }): ReactNode {
  const rows = buildReviewMatrixRows(
    data.validation.expectedMatrix,
    data.validation.matrixResults
  );
  const summary = summarizeReviewValidation(data.validation);

  // 機器審核關閉時沒有任何矩陣證據，照常渲染表格會是滿排「—」與
  // 「0 / N 存在異常」，看起來像驗證失敗。改為明確說明未執行的狀態，
  // 並告知審核者需要自行取得腳本驗證。
  if (data.validation.status === 'skipped') {
    return (
      <section className="rd-card">
        <header className="rd-card-head">
          <div>
            <h2>驗證矩陣</h2>
            <p>本平台目前未啟用機器審核，此版本沒有自動驗證證據。</p>
          </div>
          <div className="rd-matrix-summary">
            <strong>—</strong>
            <span>未執行</span>
          </div>
        </header>
        <div className="rd-skipped-note">
          <p>
            <strong>機器審核已預設關閉，此版本未經過機器審核。</strong>
          </p>
          <p>
            平台未在隔離環境中實際執行安裝與解除安裝腳本，因此無法提供
            退出碼、遙測與清理結果等證據。請自行下載腳本，在真實環境確認
            行為符合預期後再做決定。
          </p>
          <p className="rd-skipped-targets">
            待確認的目標組合：
            {rows.map(({ target }) => (
              <span key={`${target.os}:${target.client}`} className="mono">
                {target.os} × {target.client}
              </span>
            ))}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rd-card">
      <header className="rd-card-head">
        <div>
          <h2>驗證矩陣</h2>
          <p>每一個預期 OS × Client 都必須有完整證據。</p>
        </div>
        <div className="rd-matrix-summary">
          <strong>{summary.passed} / {summary.total}</strong>
          <span>{summary.passed === summary.total ? '全部通過' : '存在異常'}</span>
        </div>
      </header>
      <div className="scroll-x rd-matrix-wrap">
        <table className="rd-matrix">
          <thead>
            <tr>
              <th>目標</th><th>Runner</th><th>安裝</th><th>遙測</th>
              <th>解除安裝</th><th>清理</th><th>結果</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ target, result }) => (
              <tr key={`${target.os}:${target.client}`}>
                <td className="mono">{target.os} × {target.client}</td>
                <td className="mono">
                  {result ? `${result.runnerName}/${result.runnerVersion}` : '—'}
                </td>
                <td className="mono">{exitCode(result?.installExitCode)}</td>
                <td>{result?.telemetrySeen === true ? <span className="rd-pass">已觀測</span> : '—'}</td>
                <td className="mono">{exitCode(result?.uninstallExitCode)}</td>
                <td>{result ? (result.cleanupSucceeded ? <span className="rd-pass">成功</span> : <span className="rd-fail">失敗</span>) : '—'}</td>
                <td>{resultLabel(result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CommandCopyButton({ command }: { command: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }, [command]);

  return <Button onClick={copy}>{copied ? '已複製' : '複製'}</Button>;
}

/**
 * 命令全文。命令保存在每個「系統 × Client」組合的 script target 上，
 * 版本層級的 installCommand 只是舊欄位，實際發布流程不再寫入，
 * 直接讀它會讓審核者看到空白區塊、無從審閱真正要執行的命令。
 */
function CommandBlock({
  title,
  targets,
  pick
}: {
  title: string;
  targets: ScriptTargetRecord[];
  pick: (revision: ScriptTargetRevision) => string;
}): ReactNode {
  const entries = targets
    .map((target) => ({
      id: target.id,
      label: `${target.targetOs} × ${target.clientRuntime}`,
      command: target.currentRevision ? pick(target.currentRevision) : ''
    }))
    .filter((entry) => entry.command.trim().length > 0);

  return (
    <section className="rd-card rd-command">
      <header className="rd-card-head">
        <div className="rd-command-title">
          <h2>{title}</h2>
          <Chip tone="seal">發布者命令</Chip>
        </div>
      </header>
      {entries.length === 0 ? (
        <p className="rd-command-empty">
          這個版本沒有任何組合填寫此命令；沒有命令可審閱時不應核准。
        </p>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="rd-command-target">
            <div className="rd-command-target-head">
              <span className="mono">{entry.label}</span>
              <CommandCopyButton command={entry.command} />
            </div>
            <pre tabIndex={0}><code>{entry.command}</code></pre>
          </div>
        ))
      )}
    </section>
  );
}

function ResidualAndAttempts({ data }: { data: ReviewWorkbench }): ReactNode {
  return (
    <section className="rd-card">
      <header className="rd-card-head">
        <div><h2>殘留與驗證歷程</h2><p>發布者聲明與 runner 證據分開呈現，不互相推導。</p></div>
      </header>
      <div className="rd-card-body">
        <div className="rd-facts">
          <div data-warn={data.version.hasResidualEffects ? '' : undefined}>
            <span>殘留影響</span>
            <strong>{data.version.hasResidualEffects ? (data.version.residualDescription ?? '發布者未提供說明') : '無殘留'}</strong>
          </div>
          <div><span>手動清理</span><strong>{data.version.manualCleanupSteps ?? '不需要'}</strong></div>
          <div><span>驗證開始</span><strong className="mono">{formatDateTime(data.validation.startedAt)}</strong></div>
          <div><span>Runner version</span><strong className="mono">{data.validation.runnerVersion}</strong></div>
        </div>
        <div className="rd-attempts">
          {data.validation.attempts.map((attempt) => (
            <div className="rd-attempt" key={attempt.attempt}>
              <Chip tone={attempt.status === 'passed' ? 'ok' : attempt.status === 'failed' ? 'stop' : 'neutral'}>#{attempt.attempt}</Chip>
              <div>
                <strong>{attempt.kind === 'initial' ? '初次驗證' : '重試驗證'} · {attempt.status}</strong>
                <span>{attempt.matrixResults.length} 組證據 · {attempt.requestedByUid}</span>
              </div>
              <time className="mono" dateTime={attempt.startedAt}>{formatDateTime(attempt.startedAt)}</time>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DecisionPanel({
  data,
  review,
  onDecided,
  onSync
}: {
  data: ReviewWorkbench;
  review: PublicationReview;
  onDecided: (review: PublicationReview) => void;
  onSync: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const approveButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogErrorRef = useRef<HTMLParagraphElement>(null);
  const status = reviewStatusMeta(review.status);
  const summary = summarizeReviewValidation(data.validation);
  const readiness = summarizeDecisionReadiness(data.validation);

  const closeConfirmation = useCallback(() => {
    setConfirming(false);
    requestAnimationFrame(() => approveButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirming && !dialog.open) {
      dialog.showModal();
      confirmButtonRef.current?.focus();
    } else if (!confirming && dialog.open) {
      dialog.close();
    }
  }, [confirming]);

  useEffect(() => {
    if (confirming && error) dialogErrorRef.current?.focus();
  }, [confirming, error]);

  const submit = useCallback(async (decision: ReviewDecision) => {
    if (needsSync) return;
    const validationError = reviewDecisionError(decision, reason);
    if (validationError) {
      setError(validationError);
      if (decision === 'reject') reasonRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setNeedsSync(false);
    setError('');
    try {
      const result = await decideReview(review.id, decision, reason);
      setConfirming(false);
      onDecided(result.review);
    } catch (caught) {
      const recovery = reviewMutationRecovery(caught);
      if (recovery === 'reload') {
        setConfirming(false);
        onSync();
        return;
      }
      setNeedsSync(recovery === 'sync-required');
      setError(caught instanceof ApiError ? caught.message : '決議失敗，請重新嘗試。');
    } finally {
      setSubmitting(false);
    }
  }, [needsSync, onDecided, onSync, reason, review.id]);

  return (
    <aside className="rd-card rd-decision" aria-label="審核決議">
      <div className={`rd-decision-mark rd-tone-${status.tone}`} />
      <header className="rd-decision-head">
        <h2>發布決議</h2>
        <p>{status.canDecide ? '完成證據閱讀後，在同一位置作出單筆決議。' : '這筆審核已完成決議，以下內容為唯讀記錄。'}</p>
      </header>
      {data.validation.status === 'skipped' ? (
        <p className="rd-skipped-banner" role="status">
          <b>機器審核已預設關閉，此版本未經過機器審核。</b><br />
          下方沒有自動驗證證據可供參考，請自行下載腳本在真實環境確認後再決議。
        </p>
      ) : null}
      <div className="rd-readiness">
        {/* 機器審核關閉時沒有證據可統計，顯示「未執行」而非 0 通過／有缺失，
            後者會讀成驗證失敗，與實際情況不符。 */}
        <div><span>驗證矩陣</span><strong>{data.validation.status === 'skipped' ? '未執行' : `${summary.passed} / ${summary.total} 通過`}</strong></div>
        <div><span>遙測證據</span><strong>{data.validation.status === 'skipped' ? '未執行' : readiness.telemetryComplete ? '完整' : '有缺失'}</strong></div>
        <div><span>清理驗證</span><strong>{data.validation.status === 'skipped' ? '未執行' : readiness.cleanupComplete ? '成功' : '有失敗'}</strong></div>
        <div><span>殘留聲明</span><strong data-warn={data.version.hasResidualEffects ? '' : undefined}>{data.version.hasResidualEffects ? '有殘留' : '無殘留'}</strong></div>
      </div>
      <p className="rd-policy"><b>審核迴避由伺服器強制執行。</b><br />作者、同團隊或未指派人員無法讀取或決議此審核。</p>
      {status.canDecide ? (
        <div className="rd-decision-form">
          <label htmlFor="review-reason">決議理由 <span>核准可選填；駁回必填</span></label>
          <textarea
            id="review-reason"
            ref={reasonRef}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'review-reason-help review-reason-error' : 'review-reason-help'}
            maxLength={5000}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (!needsSync) setError('');
            }}
            placeholder="記錄證據判斷或需要作者修正的項目"
          />
          <div id="review-reason-help" className="rd-field-help"><span>最多 5,000 字</span><span>{reason.length.toLocaleString()} / 5,000</span></div>
          {error ? <p id="review-reason-error" className="rd-form-error" role="alert">{error}</p> : null}
          <div className="rd-actions">
            <Button variant="danger" disabled={submitting || needsSync} onClick={() => void submit('reject')}>駁回</Button>
            <button ref={approveButtonRef} type="button" className="btn btn-primary" disabled={submitting || needsSync} onClick={() => {
              const validationError = nextReviewDecisionError('approve', reason);
              setError(validationError);
              if (!validationError) setConfirming(true);
            }}>核准發布</button>
          </div>
          {needsSync ? <Button onClick={onSync}>重新同步狀態</Button> : null}
        </div>
      ) : (
        <div className="rd-readonly">
          <Chip tone={status.tone}>{status.label}</Chip>
          <dl>
            <dt>審核者</dt><dd className="mono">{review.reviewerUid ?? '—'}</dd>
            <dt>決議時間</dt><dd>{review.decidedAt ? formatDateTime(review.decidedAt) : '—'}</dd>
            <dt>決議理由</dt><dd>{review.decisionReason?.trim() || '未填寫理由'}</dd>
          </dl>
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="rd-modal"
        aria-labelledby="approve-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!submitting) closeConfirmation();
        }}
      >
        <h2 id="approve-title">核准 {data.package.name} {data.version.version}？</h2>
        <p>核准後版本會發布，員工即可下載。決議理由會一併保留。</p>
        {error ? (
          <p className="rd-modal-error" role="alert" tabIndex={-1} ref={dialogErrorRef}>
            {error}
          </p>
        ) : null}
        {needsSync ? (
          <p className="rd-modal-sync">這次提交的結果不確定，請先同步伺服器狀態，不要重送決議。</p>
        ) : null}
        <div>
          <Button disabled={submitting} onClick={closeConfirmation}>返回檢查</Button>
          {needsSync ? (
            <Button variant="primary" disabled={submitting} onClick={onSync}>重新同步狀態</Button>
          ) : (
            <button
              ref={confirmButtonRef}
              type="button"
              className="btn btn-primary"
              disabled={submitting}
              onClick={() => void submit('approve')}
            >
              {submitting ? '處理中…' : '確認核准'}
            </button>
          )}
        </div>
      </dialog>
    </aside>
  );
}

/**
 * 分級核定。
 *
 * 值取自技能當前狀態而非 data.package：後者是送審當下的快照，
 * 若分級在送審後被改過，拿快照當初始值會讓審核人一送出就改回舊值。
 *
 * 與發布決議分開呈現，因為兩者的作用範圍不同：決議針對這個版本，
 * 分級針對整個技能，且核准之後仍可調整。
 */
function GradePanel({ packageId }: { packageId: string }): ReactNode {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchPackageDetail(packageId, signal),
    [packageId]
  );
  const { pageState, reload } = usePageState(fetcher, [packageId]);
  const [grade, setGrade] = useState<PackageGrade | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const current = pageState.state === 'success' ? pageState.data.grade : undefined;
  const selected = grade || current;

  const submit = useCallback(async () => {
    if (!selected || selected === current) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      await setPackageGrade(packageId, selected);
      setGrade('');
      setMessage('分級已更新。');
      reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : '核定分級失敗，請重新嘗試。'
      );
    } finally {
      setSubmitting(false);
    }
  }, [current, packageId, reload, selected]);

  return (
    <section className="rd-card" aria-label="技能分級">
      <header className="rd-card-head">
        <div>
          <h2>技能分級</h2>
          <p>分級屬於整個技能，核准之後仍可調整，不需重新送審。</p>
        </div>
        {current ? <Chip tone={GRADE_TONE[current]}>{GRADE_LABEL[current]}</Chip> : null}
      </header>
      <div className="rd-card-body">
        {pageState.state === 'error' ? (
          <p className="rd-form-error" role="alert">
            讀不到技能當前分級。<Button onClick={reload}>重試</Button>
          </p>
        ) : (
          <div className="rd-grade-form">
            <label htmlFor="package-grade">核定為</label>
            <Select
              id="package-grade"
              value={selected ?? ''}
              disabled={!current || submitting}
              options={Object.entries(GRADE_LABEL).map(([value, label]) => ({
                value,
                label
              }))}
              onChange={(next) => setGrade(next as PackageGrade)}
            />
            <Button
              variant="primary"
              disabled={!current || submitting || selected === current}
              onClick={() => void submit()}
            >
              {submitting ? '核定中…' : '核定分級'}
            </Button>
          </div>
        )}
        <p aria-live="polite" aria-atomic="true">
          {error ? (
            <span className="rd-form-error" role="alert">{error}</span>
          ) : (
            message
          )}
        </p>
      </div>
    </section>
  );
}

function ReviewDetailBody({
  data,
  onSync
}: {
  data: ReviewWorkbench;
  onSync: () => void;
}): ReactNode {
  const [review, setReview] = useState(data.review);
  const status = reviewStatusMeta(review.status);

  return (
    <div className="rd">
      <Breadcrumb
        items={[
          { label: '審核', to: '/reviews' },
          { label: '待審列表', to: '/reviews' },
          { label: `${data.package.name} ${data.version.version}` }
        ]}
      />
      {/*
        提交者緊跟在標題下方：它是這筆審核的來源資訊，與標題同屬一組，
        放到右側會在寬螢幕上與標題拉開一整行的距離。
      */}
      <header className="rd-head">
        <h1>{data.package.name} <span className="mono">{data.version.version}</span></h1>
        <p className="rd-head-meta">提交者 <b className="mono">{review.authorUid}</b> · <time dateTime={review.createdAt}>{formatDateTime(review.createdAt)}</time></p>
        <p className="rd-head-sub"><Chip tone={status.tone}>{status.label}</Chip>{data.package.purpose}</p>
      </header>
      <section className="rd-context" aria-label="審核上下文">
        <div><span>Package ID</span><strong className="mono">{data.package.packageId}</strong></div>
        <div><span>Owner team</span><strong>{data.package.ownerTeam}</strong></div>
        <div><span>類型／分類</span><strong>{data.package.type === 'skill' ? 'Skill' : 'Tool'} · {data.package.category}</strong></div>
        <div><span>Script digest</span><strong className="mono">{data.validation.scriptDigest}</strong></div>
      </section>
      <div className="rd-desk">
        <div className="rd-stack">
          <MatrixEvidence data={data} />
          <CommandBlock
          title="安裝命令全文"
          targets={data.version.scriptTargets ?? []}
          pick={(revision) => revision.installCommand}
        />
          <CommandBlock
          title="解除安裝命令全文"
          targets={data.version.scriptTargets ?? []}
          pick={(revision) => revision.uninstallCommand}
        />
          <ResidualAndAttempts data={data} />
          <GradePanel packageId={data.package.packageId} />
        </div>
        <DecisionPanel data={data} review={review} onDecided={setReview} onSync={onSync} />
      </div>
    </div>
  );
}

export function ReviewDetailPage(): ReactNode {
  const { reviewId } = useParams<{ reviewId: string }>();
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchReview(reviewId ?? '', signal),
    [reviewId]
  );
  const { pageState, reload } = usePageState(fetcher, [reviewId]);

  return (
    <PageStateView pageState={pageState} onRetry={reload}>
      {(data) => <ReviewDetailBody key={data.review.id} data={data} onSync={reload} />}
    </PageStateView>
  );
}

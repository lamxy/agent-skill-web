// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { searchPackages } from '../api/catalog.js';
import { ApiError } from '../api/client.js';
import {
  fetchFeedback,
  fetchFeedbackSummary,
  fetchSupportChannels,
  saveSupportChannels,
  updateFeedbackStatus
} from '../api/experience.js';
import type {
  FeedbackIssueCategory,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackSummary,
  SupportChannel,
  SupportChannelType
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { Button, Chip } from '../components/primitives.js';
import { AdminHeader } from './AdminNav.js';
import { governancePackageOptions } from './admin-model.js';
import {
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_STATUS_LABEL,
  MAX_SUPPORT_CHANNELS,
  SATISFACTION_LABEL,
  SUPPORT_CHANNEL_LABEL,
  filterFeedback,
  toSupportChannelPayload,
  validateSupportChannels,
  type FeedbackFilter,
  type SupportChannelDraft
} from './experience-model.js';
import './admin.css';
import './support-admin.css';

const CHANNEL_TYPES = Object.entries(SUPPORT_CHANNEL_LABEL) as Array<
  [SupportChannelType, string]
>;
const CATEGORIES = Object.entries(FEEDBACK_CATEGORY_LABEL) as Array<
  [FeedbackIssueCategory, string]
>;
const STATUSES = Object.entries(FEEDBACK_STATUS_LABEL) as Array<
  [FeedbackStatus, string]
>;

function toDraft(channels: SupportChannel[]): SupportChannelDraft[] {
  return channels.map((channel) => ({
    id: channel.id,
    channelType: channel.channelType,
    label: channel.label,
    address: channel.address,
    ...(channel.instructions ? { instructions: channel.instructions } : {}),
    displayOrder: channel.displayOrder
  }));
}

function ChannelEditor({
  packageId,
  initial
}: {
  packageId: string;
  initial: SupportChannel[];
}): ReactNode {
  const [draft, setDraft] = useState<SupportChannelDraft[]>(() => toDraft(initial));
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const patch = (index: number, key: keyof SupportChannelDraft, value: string) => {
    setDraft((current) =>
      current.map((item, position) =>
        position === index ? { ...item, [key]: value } : item
      )
    );
  };

  const handleSave = useCallback(async () => {
    const invalid = validateSupportChannels(draft);
    if (invalid) {
      setError(invalid);
      setMessage('');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const saved = await saveSupportChannels(
        packageId,
        toSupportChannelPayload(draft)
      );
      // 只依伺服器回應更新畫面，不做樂觀假存。
      setDraft(toDraft(saved));
      setMessage(`已儲存 ${saved.length} 個支援渠道。`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '儲存支援渠道失敗。');
    } finally {
      setSaving(false);
    }
  }, [draft, packageId]);

  return (
    <section className="adm-panel sa-panel">
      <div className="adm-panel-head">
        <div>
          <h2>支援渠道</h2>
          <p>使用者在套件詳情頁看到的求助入口。</p>
        </div>
        <span>
          {draft.length} / {MAX_SUPPORT_CHANNELS}
        </span>
      </div>

      <p className="sa-warn">
        <strong>整組覆寫</strong>
        送出的清單即為完整結果。你在這裡移除的渠道會被刪除，後端不做增量合併。
      </p>

      {error ? (
        <p className="adm-message sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="adm-message" role="status">
          {message}
        </p>
      ) : null}

      {draft.length === 0 ? (
        <p className="adm-empty-inline">
          目前沒有任何渠道。直接儲存會清除全部支援入口。
        </p>
      ) : (
        <ol className="sa-rows">
          {draft.map((channel, index) => (
            <li key={channel.id ?? `new-${index}`} className="sa-row">
              <label>
                渠道類型
                <Select
                  value={channel.channelType}
                  onChange={(value) => patch(index, 'channelType', value)}
                  ariaLabel="渠道類型"
                  options={CHANNEL_TYPES.map(([value, label]) => ({ value, label }))}
                />
              </label>
              <label>
                顯示名稱
                <input
                  value={channel.label}
                  maxLength={200}
                  placeholder="例如：技能支援群"
                  onChange={(event) => patch(index, 'label', event.target.value)}
                />
              </label>
              <label>
                位址
                <input
                  value={channel.address}
                  maxLength={2000}
                  placeholder="網址或信箱"
                  onChange={(event) => patch(index, 'address', event.target.value)}
                />
              </label>
              <button
                type="button"
                className="sa-del"
                aria-label={`移除第 ${index + 1} 個渠道`}
                onClick={() =>
                  setDraft((current) =>
                    current.filter((_, position) => position !== index)
                  )
                }
              >
                ✕
              </button>
              <label className="sa-wide">
                補充說明（選填）
                <textarea
                  value={channel.instructions ?? ''}
                  maxLength={5000}
                  rows={2}
                  placeholder="例如回覆時間、需要附上哪些資訊"
                  onChange={(event) => patch(index, 'instructions', event.target.value)}
                />
              </label>
            </li>
          ))}
        </ol>
      )}

      <div className="sa-bar">
        <Button
          disabled={draft.length >= MAX_SUPPORT_CHANNELS}
          onClick={() =>
            setDraft((current) => [
              ...current,
              {
                channelType: 'im_group',
                label: '',
                address: '',
                displayOrder: current.length
              }
            ])
          }
        >
          新增一列
        </Button>
        <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '儲存中…' : '儲存支援渠道'}
        </Button>
      </div>
    </section>
  );
}

function SummaryBars({
  rows,
  label
}: {
  rows: Array<{ key: string; label: string; count: number }>;
  label: string;
}): ReactNode {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="sa-bars" role="img" aria-label={label}>
      {rows.map((row) => (
        <div
          key={row.key}
          className="sa-brow"
          data-zero={row.count === 0 ? '' : undefined}
        >
          <span>{row.label}</span>
          <div className="sa-track">
            <div className="sa-fill" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
          <b className="tabular">{row.count}</b>
        </div>
      ))}
    </div>
  );
}

function FeedbackConsole({
  summary,
  records
}: {
  summary: FeedbackSummary;
  records: FeedbackRecord[];
}): ReactNode {
  const [local, setLocal] = useState(records);
  const [filter, setFilter] = useState<FeedbackFilter>({});
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  const shown = useMemo(() => filterFeedback(local, filter), [filter, local]);

  const changeStatus = useCallback(async (id: string, status: FeedbackStatus) => {
    setBusyId(id);
    setError(undefined);
    try {
      const updated = await updateFeedbackStatus(id, status);
      setLocal((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '變更反饋狀態失敗。');
    } finally {
      setBusyId(undefined);
    }
  }, []);

  return (
    <>
      <div className="sa-metrics">
        <div className="adm-panel sa-metric">
          <b className="tabular">{summary.total}</b>
          <span>反饋總數</span>
        </div>
        <div className="adm-panel sa-metric">
          <b className="tabular">
            {summary.averageSatisfaction === null
              ? '—'
              : summary.averageSatisfaction.toFixed(2)}
          </b>
          <span>平均滿意度</span>
        </div>
        <div className="adm-panel sa-metric">
          <b className="tabular">{summary.openNeedsHumanSupport}</b>
          <span>待處理的人工協助</span>
        </div>
        <div className="adm-panel sa-metric">
          <b className="tabular">{summary.needsHumanSupport}</b>
          <span>累計人工協助請求</span>
        </div>
      </div>

      <section className="adm-panel sa-panel">
        <div className="adm-panel-head">
          <div>
            <h2>滿意度與分類分布</h2>
            <p>滿意度為自願填寫的自我聲明，樣本不代表全體使用者。</p>
          </div>
          <span>數據僅供參考</span>
        </div>
        <SummaryBars
          label="滿意度分布"
          rows={summary.satisfactionDistribution.map((row) => ({
            key: `s-${row.satisfaction}`,
            label: `${SATISFACTION_LABEL[row.satisfaction] ?? row.satisfaction} (${row.satisfaction})`,
            count: row.count
          }))}
        />
        <hr className="sa-sep" />
        <SummaryBars
          label="問題分類分布"
          rows={summary.byCategory.map((row) => ({
            key: row.issueCategory,
            label: FEEDBACK_CATEGORY_LABEL[row.issueCategory],
            count: row.count
          }))}
        />
        <p className="sa-rule">
          計數 0 的分類不隱藏：「沒有這個分類」與「這個分類無人回報」是兩件事。
        </p>
      </section>

      <section className="adm-panel sa-panel">
        <div className="adm-panel-head">
          <div>
            <h2>反饋明細</h2>
            <p>含自由文字，只有維護者可讀。</p>
          </div>
          <span>
            {shown.length} / {local.length} 筆
          </span>
        </div>

        <div className="sa-filters">
          <label>
            分類
            <Select
              value={filter.issueCategory ?? ''}
              ariaLabel="分類"
              onChange={(next) =>
                setFilter((current) => {
                  const { issueCategory: _drop, ...rest } = current;
                  return next
                    ? { ...rest, issueCategory: next as FeedbackIssueCategory }
                    : rest;
                })
              }
              options={[
                { value: '', label: '全部分類' },
                ...CATEGORIES.map(([value, label]) => ({ value, label }))
              ]}
            />
          </label>
          <label>
            人工協助
            <Select
              value={
                filter.needsHumanSupport === undefined
                  ? ''
                  : String(filter.needsHumanSupport)
              }
              ariaLabel="人工協助"
              onChange={(next) =>
                setFilter((current) => {
                  const { needsHumanSupport: _drop, ...rest } = current;
                  return next
                    ? { ...rest, needsHumanSupport: next === 'true' }
                    : rest;
                })
              }
              options={[
                { value: '', label: '不分' },
                { value: 'true', label: '需要人工協助' },
                { value: 'false', label: '不需人工協助' }
              ]}
            />
          </label>
          <label>
            處理狀態
            <Select
              value={filter.status ?? ''}
              ariaLabel="處理狀態"
              onChange={(next) =>
                setFilter((current) => {
                  const { status: _drop, ...rest } = current;
                  return next ? { ...rest, status: next as FeedbackStatus } : rest;
                })
              }
              options={[
                { value: '', label: '全部狀態' },
                ...STATUSES.map(([value, label]) => ({ value, label }))
              ]}
            />
          </label>
        </div>

        {error ? (
          <p className="adm-message sa-error" role="alert">
            {error}
          </p>
        ) : null}

        {shown.length === 0 ? (
          <p className="adm-empty-inline">沒有符合條件的反饋。</p>
        ) : (
          shown.map((record) => (
            <article key={record.id} className="sa-fb">
              <header className="sa-fb-head">
                <strong className="mono">{record.version}</strong>
                <Chip tone="neutral">
                  {FEEDBACK_CATEGORY_LABEL[record.issueCategory]}
                </Chip>
                <Chip tone="neutral">滿意度 {record.satisfaction}</Chip>
                {record.needsHumanSupport ? (
                  <Chip tone="warn">需要人工協助</Chip>
                ) : null}
                <Chip
                  tone={
                    record.status === 'resolved'
                      ? 'ok'
                      : record.status === 'acknowledged'
                        ? 'warn'
                        : 'seal'
                  }
                >
                  {FEEDBACK_STATUS_LABEL[record.status]}
                </Chip>
              </header>
              <p className="sa-fb-detail">{record.detail}</p>
              <footer className="sa-fb-foot">
                <small className="mono">
                  {record.authorRefType}:{record.authorRef} ·{' '}
                  {new Date(record.createdAt).toLocaleString('zh-Hant')}
                </small>
                <span className="sa-fb-actions">
                  {record.status === 'open' ? (
                    <Button
                      disabled={busyId === record.id}
                      onClick={() => void changeStatus(record.id, 'acknowledged')}
                    >
                      標記已受理
                    </Button>
                  ) : null}
                  {record.status === 'resolved' ? (
                    <Button
                      disabled={busyId === record.id}
                      onClick={() => void changeStatus(record.id, 'open')}
                    >
                      重新開啟
                    </Button>
                  ) : (
                    <Button
                      disabled={busyId === record.id}
                      onClick={() => void changeStatus(record.id, 'resolved')}
                    >
                      標記已解決
                    </Button>
                  )}
                </span>
              </footer>
            </article>
          ))
        )}
      </section>
    </>
  );
}

interface SupportConsoleData {
  channels: SupportChannel[];
  summary: FeedbackSummary;
  records: FeedbackRecord[];
}

function SupportConsole({ packageId }: { packageId: string }): ReactNode {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<SupportConsoleData> => {
      const [channels, summary, records] = await Promise.all([
        fetchSupportChannels(packageId, signal),
        fetchFeedbackSummary(packageId, signal),
        fetchFeedback(packageId, {}, signal)
      ]);
      return { channels, summary, records };
    },
    [packageId]
  );
  const { pageState, reload } = usePageState(fetcher, [packageId]);

  return (
    <PageStateView pageState={pageState} onRetry={reload}>
      {(data) => (
        <>
          <ChannelEditor packageId={packageId} initial={data.channels} />
          <FeedbackConsole summary={data.summary} records={data.records} />
        </>
      )}
    </PageStateView>
  );
}

export function PackageSupportAdminPage(): ReactNode {
  const [packageId, setPackageId] = useState('');
  const fetcher = useCallback(
    (signal: AbortSignal) => searchPackages({ limit: 100, sort: 'name_asc' }, signal),
    []
  );
  const { pageState, reload } = usePageState(fetcher, [], {
    isEmpty: (data) => data.items.length === 0,
    emptyMessage: '目前沒有可設定支援入口的套件。'
  });

  // 自訂下拉不是原生表單控制項，值取自 state 而非 FormData。
  const [packageIdDraft, setPackageIdDraft] = useState('');
  const locate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPackageId(packageIdDraft.trim());
  };

  return (
    <div className="adm">
      <AdminHeader
        title="支援與反饋"
        description="設定使用者的求助入口，並處理結構化使用反饋。"
      />
      <PageStateView pageState={pageState} onRetry={reload}>
        {(data) => (
          <form className="adm-locate" onSubmit={locate}>
            <label>
              <span className="label-text">套件</span>
              <Select
                value={packageIdDraft}
                onChange={setPackageIdDraft}
                placeholder="選擇真實套件"
                options={governancePackageOptions(data.items)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={!packageIdDraft}>
              載入
            </Button>
          </form>
        )}
      </PageStateView>
      {packageId ? (
        <SupportConsole key={packageId} packageId={packageId} />
      ) : (
        <div className="adm-start-state">
          <strong>尚未選擇套件</strong>
          <p>從 Catalog 的真實套件清單選擇後載入支援渠道與反饋。</p>
        </div>
      )}
    </div>
  );
}

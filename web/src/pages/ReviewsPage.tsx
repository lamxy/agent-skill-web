// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { fetchReviews } from '../api/reviews.js';
import type {
  PublicationReviewStatus,
  ReviewFilters,
  ReviewWorkbench
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { ReviewIcon } from '../components/icons.js';
import { Chip } from '../components/primitives.js';
import {
  isEmptyReviewPage,
  previousReviewCursor,
  readReviewFilters,
  replaceReviewCursor,
  reviewQueueCopy,
  summarizeReviewValidation
} from './reviews-model.js';
import './reviews.css';

const STATUS_OPTIONS: Array<{
  value: PublicationReviewStatus;
  label: string;
}> = [
  { value: 'pending', label: '待審' },
  { value: 'approved', label: '已核准' },
  { value: 'rejected', label: '已駁回' },
  { value: 'superseded', label: '已取代' }
];

const submittedAtFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function ReviewRow({ workbench }: { workbench: ReviewWorkbench }): ReactNode {
  const validation = summarizeReviewValidation(workbench.validation);
  const submittedAt = new Date(workbench.review.createdAt);
  const anomalyCount =
    validation.failed + validation.notSupported + validation.missing;

  return (
    <tr>
      <td className="rv-package">
        <strong>{workbench.package.name}</strong>
        <span className="mono">{workbench.package.packageId}</span>
      </td>
      <td className="mono tabular">{workbench.version.version}</td>
      <td>
        <div className="rv-tags">
          <Chip>{workbench.package.type === 'skill' ? 'Skill' : 'Tool'}</Chip>
          <Chip>{workbench.package.category}</Chip>
        </div>
      </td>
      <td>
        <div className="rv-tags">
          {workbench.version.supportedOs.map((os) => (
            <Chip key={os} mono>
              {os}
            </Chip>
          ))}
        </div>
      </td>
      <td>
        <div className="rv-tags">
          {workbench.version.supportedClients.map((client) => (
            <Chip key={client.name} tone="seal" mono>
              {client.name}
            </Chip>
          ))}
        </div>
      </td>
      <td>
        <div
          className="rv-matrix"
          aria-label={`驗證矩陣 ${validation.passed} / ${validation.total} 通過，異常 ${anomalyCount}：失敗 ${validation.failed}、不支援 ${validation.notSupported}、缺失 ${validation.missing}`}
        >
          <strong className="tabular">
            {validation.passed} / {validation.total}
          </strong>
          <span>
            {anomalyCount > 0
              ? `異常 ${anomalyCount}`
              : '全部通過'}
          </span>
        </div>
      </td>
      <td>
        {workbench.version.hasResidualEffects ? (
          <Chip tone="warn">有殘留</Chip>
        ) : (
          <Chip tone="ok">無殘留</Chip>
        )}
      </td>
      <td className="rv-submission">
        <span className="mono">{workbench.review.authorUid}</span>
        <time dateTime={workbench.review.createdAt}>
          {Number.isNaN(submittedAt.getTime())
            ? workbench.review.createdAt
            : submittedAtFormatter.format(submittedAt)}
        </time>
      </td>
      <td className="rv-action">
        <Link to={`/reviews/${workbench.review.id}`}>查看審核</Link>
      </td>
    </tr>
  );
}

function writeFilters(filters: ReviewFilters): URLSearchParams {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.os) params.set('os', filters.os);
  if (filters.client) params.set('client', filters.client);
  if (filters.cursor) params.set('cursor', filters.cursor);
  return params;
}

/*
 * 篩選表單。自訂下拉不是原生表單控制項，FormData 讀不到值，
 * 因此草稿改由 state 保存；由呼叫端以 key 掛載，網址參數變動時
 * 整個元件重建、草稿自然回到當前值，沿用原本 key={formKey} 的重置語意。
 */
function ReviewFilterForm({
  filters,
  onApply,
  onClear
}: {
  filters: ReviewFilters;
  onApply: (draft: { status: string; os: string; client: string }) => void;
  onClear: () => void;
}): ReactNode {
  const [draft, setDraft] = useState({
    status: String(filters.status),
    os: filters.os ?? '',
    client: filters.client ?? ''
  });

  return (
    <form
      className="rv-filters"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <label>
        <span>狀態</span>
        <Select
          value={draft.status}
          onChange={(value) => setDraft((current) => ({ ...current, status: value }))}
          options={STATUS_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label
          }))}
          ariaLabel="審核狀態"
        />
      </label>
      <label>
        <span>作業系統</span>
        <Select
          value={draft.os}
          onChange={(value) => setDraft((current) => ({ ...current, os: value }))}
          options={[
            { value: '', label: '全部' },
            { value: 'linux', label: 'linux' },
            { value: 'windows', label: 'windows' },
            { value: 'macos', label: 'macos' }
          ]}
          ariaLabel="作業系統"
        />
      </label>
      <label>
        <span>Client</span>
        <Select
          value={draft.client}
          onChange={(value) => setDraft((current) => ({ ...current, client: value }))}
          options={[
            { value: '', label: '全部' },
            { value: 'codex', label: 'Codex' },
            { value: 'claude-code', label: 'Claude Code' }
          ]}
          ariaLabel="Client"
        />
      </label>
      <button className="rv-apply" type="submit">
        套用篩選
      </button>
      <button className="rv-clear" type="button" onClick={onClear}>
        清除
      </button>
    </form>
  );
}

export function ReviewsPage(): ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readReviewFilters(searchParams), [searchParams]);
  const copy = reviewQueueCopy(filters.status);
  const formKey = `${filters.status}|${filters.os ?? ''}|${filters.client ?? ''}`;

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchReviews(filters, signal),
    [filters]
  );
  const { pageState, reload } = usePageState(fetcher, [filters], {
    isEmpty: (data) => isEmptyReviewPage(filters, data),
    emptyMessage: copy.emptyMessage
  });

  const applyFilters = useCallback(
    (draft: { status: string; os: string; client: string }) => {
      setSearchParams(
        writeFilters({
          status: draft.status as PublicationReviewStatus,
          ...(draft.os ? { os: draft.os } : {}),
          ...(draft.client ? { client: draft.client } : {})
        })
      );
    },
    [setSearchParams]
  );

  const changeCursor = useCallback(
    (cursor: string | undefined) => {
      setSearchParams(writeFilters(replaceReviewCursor(filters, cursor)));
    },
    [filters, setSearchParams]
  );

  return (
    <div className="rv">
      <header className="rv-head">
        <div>
          <h1>
            <ReviewIcon className="page-title-icon" />
            {copy.title}
          </h1>
          <p>高密度掃描版本、支援範圍與驗證證據。</p>
        </div>
      </header>

      <ReviewFilterForm
        key={formKey}
        filters={filters}
        onApply={applyFilters}
        onClear={() => setSearchParams(new URLSearchParams({ status: 'pending' }))}
      />

      <div className="rv-summary">
        <span>依提交時間排序</span>
        <span>每頁 20 筆 · cursor 分頁</span>
      </div>

      <section className="rv-card" aria-label="審核佇列">
        <PageStateView pageState={pageState} onRetry={reload}>
          {(data) => (
            <>
              <div className="scroll-x">
                <table className="rv-table">
                  <thead>
                    <tr>
                      <th>技能套件</th>
                      <th>版本</th>
                      <th>類型／分類</th>
                      <th>支援系統</th>
                      <th>Client</th>
                      <th>驗證矩陣</th>
                      <th>殘留</th>
                      <th>提交者／時間</th>
                      <th className="rv-action">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((workbench) => (
                      <ReviewRow key={workbench.review.id} workbench={workbench} />
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="rv-pagination">
                <span className="tabular">本頁 {data.items.length} 筆</span>
                <div>
                  <button
                    type="button"
                    disabled={!filters.cursor}
                    onClick={() => changeCursor(previousReviewCursor(filters.cursor))}
                  >
                    上一頁
                  </button>
                  <button
                    type="button"
                    disabled={!data.nextCursor}
                    onClick={() => changeCursor(data.nextCursor)}
                  >
                    下一頁
                  </button>
                </div>
              </footer>
            </>
          )}
        </PageStateView>
      </section>
    </div>
  );
}

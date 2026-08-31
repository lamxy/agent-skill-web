// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import {
  assignReviewer,
  fetchReviewerCandidates,
  fetchReviewerAssignments,
  revokeReviewer
} from '../api/admin.js';
import { searchPackages } from '../api/catalog.js';
import type { PackageType, ReviewerAssignment } from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { FieldHelp } from '../components/FieldHelp.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { Button, Chip } from '../components/primitives.js';
import { AdminHeader } from './AdminNav.js';
import {
  reviewerCandidateOptions,
  reviewerScopeCategories
} from './admin-model.js';
import './admin.css';

const dateFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function AssignmentCard({
  assignment,
  revoking,
  onRevoke
}: {
  assignment: ReviewerAssignment;
  revoking: boolean;
  onRevoke: (assignment: ReviewerAssignment) => void;
}): ReactNode {
  return (
    <article className="adm-mobile-card">
      <div className="adm-mobile-title">
        <strong className="mono">{assignment.reviewerUid}</strong>
        <Chip tone="ok">有效</Chip>
      </div>
      <dl>
        <dt>範圍</dt>
        <dd>{assignment.packageType} · {assignment.category}</dd>
        <dt>指派者</dt>
        <dd className="mono">{assignment.assignedByUid}</dd>
        <dt>建立時間</dt>
        <dd>{dateFormatter.format(new Date(assignment.createdAt))}</dd>
      </dl>
      <Button variant="danger" disabled={revoking} onClick={() => onRevoke(assignment)}>
        {revoking ? '撤銷中…' : '撤銷指派'}
      </Button>
    </article>
  );
}

export function ReviewerAdminPage(): ReactNode {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchReviewerAssignments(signal),
    []
  );
  const { pageState, reload } = usePageState(fetcher, [], {
    isEmpty: (items) => items.length === 0,
    emptyMessage: '目前沒有有效審核者指派，可使用上方表單建立第一筆。'
  });
  const [mutationError, setMutationError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState('');
  const [packageType, setPackageType] = useState<PackageType>('skill');
  const [category, setCategory] = useState('');
  // 自訂下拉不是原生表單控制項，值改由 state 保存而非 FormData 讀取。
  const [reviewerUid, setReviewerUid] = useState('');
  const optionsFetcher = useCallback(async (signal: AbortSignal) => {
    const [candidates, catalog] = await Promise.all([
      fetchReviewerCandidates(signal),
      searchPackages({ limit: 100, sort: 'name_asc' }, signal)
    ]);
    return { candidates, packages: catalog.items };
  }, []);
  const { pageState: optionsState, reload: reloadOptions } = usePageState(
    optionsFetcher,
    [],
    {
      isEmpty: (data) => data.candidates.length === 0 || data.packages.length === 0,
      emptyMessage: '尚無可用身份或套件分類，請先建立身份與套件資料。'
    }
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    setMutationError('');
    void assignReviewer({
      reviewerUid,
      packageType,
      category
    })
      .then(() => {
        formElement.reset();
        setPackageType('skill');
        setCategory('');
        setReviewerUid('');
        reload();
      })
      .catch((error: unknown) =>
        setMutationError(error instanceof Error ? error.message : '新增指派失敗。')
      )
      .finally(() => setSaving(false));
  };

  const revoke = useCallback(
    (assignment: ReviewerAssignment) => {
      if (!window.confirm(`確定撤銷 ${assignment.reviewerUid} 的 ${assignment.packageType}／${assignment.category} 審核範圍？`)) return;
      setRevokingId(assignment.id);
      setMutationError('');
      void revokeReviewer(assignment.id)
        .then(reload)
        .catch((error: unknown) =>
          setMutationError(error instanceof Error ? error.message : '撤銷指派失敗。')
        )
        .finally(() => setRevokingId(''));
    },
    [reload]
  );

  return (
    <div className="adm">
      <AdminHeader
        title="審核者管理"
        description="以套件類型與分類限制審核範圍；伺服器端仍是權限判斷唯一來源。"
      />

      <PageStateView pageState={optionsState} onRetry={reloadOptions}>
        {(options) => {
          const categories = reviewerScopeCategories(options.packages, packageType);
          return (
            <form className="adm-form adm-assignment-form" onSubmit={submit}>
              <label>
                <span className="label-text">
                  審核者
                  <FieldHelp>姓名後顯示登入 UID 與所屬團隊；提交時只保存 UID。</FieldHelp>
                </span>
                <Select
                  value={reviewerUid}
                  onChange={setReviewerUid}
                  placeholder="選擇有效使用者"
                  options={reviewerCandidateOptions(options.candidates)}
                />
              </label>
              <label>
                <span className="label-text">
                  套件類型
                  <FieldHelp>限定審核 Skill 或 Tool，不授予其他管理權限。</FieldHelp>
                </span>
                <Select
                  value={packageType}
                  onChange={(value) => {
                    setPackageType(value as PackageType);
                    setCategory('');
                  }}
                  options={[
                    { value: 'skill', label: 'Skill（技能包）' },
                    { value: 'tool', label: 'Tool（工具／MCP）' }
                  ]}
                />
              </label>
              <label>
                <span className="label-text">
                  套件分類
                  <FieldHelp>分類來自 Catalog；審核者只能處理「類型＋分類」完全匹配的套件。</FieldHelp>
                </span>
                <Select
                  value={category}
                  onChange={setCategory}
                  placeholder={`選擇 ${packageType === 'skill' ? 'Skill' : 'Tool'} 的分類`}
                  options={categories.map((item) => ({ value: item, label: item }))}
                />
              </label>
              {/* 自訂下拉沒有原生 required，必填改由送出鍵的可用狀態把關 */}
              <Button type="submit" variant="primary" disabled={saving || !category || !reviewerUid}>{saving ? '建立中…' : '新增指派'}</Button>
            </form>
          );
        }}
      </PageStateView>
      {mutationError ? <p className="adm-error" role="alert">{mutationError}</p> : null}

      <section className="adm-panel" aria-label="有效審核者指派">
        <PageStateView pageState={pageState} onRetry={reload}>
          {(items) => (
            <>
              <div className="adm-desktop-table">
                <table className="adm-table">
                  <thead><tr><th>審核者 UID</th><th>類型</th><th>分類</th><th>指派者</th><th>建立時間</th><th><span className="sr-only">操作</span></th></tr></thead>
                  <tbody>{items.map((assignment) => (
                    <tr key={assignment.id}>
                      <td className="mono">{assignment.reviewerUid}</td>
                      <td><Chip>{assignment.packageType}</Chip></td>
                      <td>{assignment.category}</td>
                      <td className="mono">{assignment.assignedByUid}</td>
                      <td>{dateFormatter.format(new Date(assignment.createdAt))}</td>
                      <td className="adm-action"><Button variant="danger" disabled={revokingId === assignment.id} onClick={() => revoke(assignment)}>{revokingId === assignment.id ? '撤銷中…' : '撤銷'}</Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="adm-mobile-list">{items.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} revoking={revokingId === assignment.id} onRevoke={revoke} />)}</div>
            </>
          )}
        </PageStateView>
      </section>
    </div>
  );
}

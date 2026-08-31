// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { fetchAuditLogs } from '../api/admin.js';
import type { AuditFilters, AuditLog, AuditTargetType } from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { FieldHelp } from '../components/FieldHelp.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { Button, Chip } from '../components/primitives.js';
import { AdminHeader } from './AdminNav.js';
import './admin.css';

const auditDateFormatter = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'medium' });

function isoFromLocal(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function AuditDetail({ log }: { log: AuditLog }): ReactNode {
  return (
    <details className="adm-audit-detail">
      <summary>查看詳情</summary>
      <dl><dt>details</dt><dd><pre>{JSON.stringify(log.details, null, 2)}</pre></dd><dt>IP</dt><dd className="mono">{log.ipAddress ?? '未記錄'}</dd><dt>User Agent</dt><dd>{log.userAgent ?? '未記錄'}</dd></dl>
    </details>
  );
}

export function AuditLogsPage(): ReactNode {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [targetTypeDraft, setTargetTypeDraft] = useState('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack.at(-1);
  const query = useMemo(() => ({ ...filters, ...(currentCursor ? { cursor: currentCursor } : {}) }), [currentCursor, filters]);
  const fetcher = useCallback((signal: AbortSignal) => fetchAuditLogs(query, signal), [query]);
  const { pageState, reload } = usePageState(fetcher, [query], {
    isEmpty: (data) => data.items.length === 0 && !currentCursor,
    emptyMessage: '目前沒有符合條件的稽核事件，請調整篩選條件。'
  });

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // 自訂下拉不是原生表單控制項，值取自 state 而非 FormData。
    const targetType = targetTypeDraft as AuditTargetType | '';
    const from = isoFromLocal(form.get('from'));
    const to = isoFromLocal(form.get('to'));
    setCursorStack([]);
    setFilters({
      ...(String(form.get('eventType') ?? '').trim() ? { eventType: String(form.get('eventType')).trim() } : {}),
      ...(String(form.get('actorUid') ?? '').trim() ? { actorUid: String(form.get('actorUid')).trim() } : {}),
      ...(targetType ? { targetType } : {}),
      ...(String(form.get('targetId') ?? '').trim() ? { targetId: String(form.get('targetId')).trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    });
  };

  return (
    <div className="adm">
      <AdminHeader title="稽核日誌" description="依 actor、事件、目標與時間範圍追溯管理操作；日誌唯讀。" />
      <form className="adm-form adm-audit-filters" onSubmit={apply}>
        <label><span className="label-text">事件類型<FieldHelp>使用稽核紀錄顯示的完整事件名稱；此欄採精確比對。</FieldHelp></span><input name="eventType" placeholder="review.approved" /></label>
        <label><span className="label-text">Actor UID<FieldHelp>使用身份目錄中的完整 UID；此欄採精確比對。</FieldHelp></span><input name="actorUid" /></label>
        <label><span className="label-text">目標類型</span><Select value={targetTypeDraft} onChange={setTargetTypeDraft} ariaLabel="目標類型" options={[{ value: '', label: '全部' }, { value: 'package', label: 'package' }, { value: 'version', label: 'version' }, { value: 'user', label: 'user' }, { value: 'role', label: 'role' }]} /></label>
        <label><span className="label-text">目標 ID<FieldHelp>依目標類型輸入完整邏輯 ID；此欄採精確比對。</FieldHelp></span><input name="targetId" /></label>
        <label><span className="label-text">開始時間</span><input name="from" type="datetime-local" /></label>
        <label><span className="label-text">結束時間</span><input name="to" type="datetime-local" /></label>
        <Button type="submit" variant="primary">套用篩選</Button>
      </form>
      <section className="adm-panel">
        <PageStateView pageState={pageState} onRetry={reload}>
          {(data) => (
            <>
              <div className="adm-desktop-table"><table className="adm-table adm-audit-table"><thead><tr><th>發生時間</th><th>事件</th><th>Actor</th><th>目標</th><th>動作</th><th>詳情</th></tr></thead><tbody>{data.items.map((log) => <tr key={log.id}><td>{auditDateFormatter.format(new Date(log.occurredAt))}</td><td><Chip tone="seal">{log.eventType}</Chip></td><td className="mono">{log.actorUid}</td><td><span>{log.targetType}</span><small className="mono">{log.targetId}</small></td><td>{log.action}</td><td><AuditDetail log={log} /></td></tr>)}</tbody></table></div>
              <div className="adm-mobile-list">{data.items.map((log) => <article key={log.id} className="adm-mobile-card"><div className="adm-mobile-title"><Chip tone="seal">{log.eventType}</Chip><time>{auditDateFormatter.format(new Date(log.occurredAt))}</time></div><dl><dt>Actor</dt><dd className="mono">{log.actorUid}</dd><dt>目標</dt><dd>{log.targetType} · <span className="mono">{log.targetId}</span></dd><dt>動作</dt><dd>{log.action}</dd></dl><AuditDetail log={log} /></article>)}</div>
              <footer className="adm-pagination"><span>本頁 {data.items.length} 筆 · 每頁 50 筆</span><div><Button disabled={cursorStack.length === 0} onClick={() => setCursorStack((stack) => stack.slice(0, -1))}>上一頁</Button><Button disabled={!data.nextCursor} onClick={() => data.nextCursor && setCursorStack((stack) => [...stack, data.nextCursor!])}>下一頁</Button></div></footer>
            </>
          )}
        </PageStateView>
      </section>
    </div>
  );
}

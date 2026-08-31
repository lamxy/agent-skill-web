// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { ApiError } from '../api/client.js';
import {
  fetchNotifications,
  markNotificationRead
} from '../api/notifications.js';
import type { UserNotification } from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { BellIcon } from '../components/icons.js';
import { PageStateView } from '../components/PageStateView.js';
import { Chip } from '../components/primitives.js';
import {
  filterNotifications,
  notificationCopy,
  payloadText,
  versionDiffPath,
  type NotificationFilter
} from './experience-model.js';
import './notifications.css';

const FILTERS: Array<[NotificationFilter, string]> = [
  ['unread', '未讀'],
  ['all', '全部'],
  ['upgrade', '新版本'],
  ['risk', '撤下與停用']
];

function NotificationLead({ item }: { item: UserNotification }): ReactNode {
  if (item.notificationType === 'version_published') {
    const installed = payloadText(item, 'installedVersion');
    return (
      <p>
        <span className="mono">{item.packageId}</span> 已發布{' '}
        <span className="mono">{item.version}</span>
        {installed ? (
          <>
            ，你目前安裝的是 <span className="mono">{installed}</span>。
          </>
        ) : (
          '，你安裝的版本較舊。'
        )}
      </p>
    );
  }
  if (item.notificationType === 'version_emergency_disabled') {
    return (
      <p>
        <span className="mono">{item.packageId}</span>{' '}
        <span className="mono">{item.version}</span> 已緊急停用，請儘快解除安裝。
      </p>
    );
  }
  return (
    <p>
      <span className="mono">{item.packageId}</span>{' '}
      <span className="mono">{item.version}</span> 已被撤下，無法再下載。
    </p>
  );
}

function NotificationCard({
  item,
  onRead,
  busy
}: {
  item: UserNotification;
  onRead: (id: string) => void;
  busy: boolean;
}): ReactNode {
  const copy = notificationCopy(item.notificationType);
  const releaseNotes = payloadText(item, 'releaseNotes');
  const reasonDetail = payloadText(item, 'reasonDetail');
  const reasonCode = payloadText(item, 'reasonCode');
  const installedVersion = payloadText(item, 'installedVersion');
  // 差異比較需要來源與目標兩個版本。舊通知的 payload 沒有 installedVersion，
  // 此時只導向套件詳情，不猜測使用者裝的是哪一版。
  const diffPath =
    item.notificationType === 'version_published' && installedVersion
      ? versionDiffPath(item.packageId, installedVersion, item.version)
      : undefined;

  return (
    <article className="nt-item" data-unread={item.status === 'unread' ? '' : undefined}>
      <div className="nt-body">
        <header className="nt-head">
          <b>{copy.title}</b>
          {item.status === 'unread' ? <Chip tone="seal">未讀</Chip> : null}
          <Chip tone={copy.tone}>{item.version}</Chip>
        </header>

        <NotificationLead item={item} />

        {releaseNotes ? <p className="nt-notes">{releaseNotes}</p> : null}
        {reasonDetail ? (
          <p className="nt-notes">
            原因：{reasonDetail}
            {reasonCode ? ` (${reasonCode})` : ''}
          </p>
        ) : null}

        <footer className="nt-foot">
          <small>{new Date(item.createdAt).toLocaleString('zh-Hant')}</small>
          <div className="nt-actions">
            {diffPath ? (
              <Link className="btn btn-primary" to={diffPath}>
                檢視差異
              </Link>
            ) : (
              <Link
                className="btn btn-ghost"
                to={`/packages/${encodeURIComponent(item.packageId)}`}
              >
                前往套件
              </Link>
            )}
            {item.status === 'unread' ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => onRead(item.id)}
              >
                標記已讀
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </article>
  );
}

function NotificationList({
  items,
  filter
}: {
  items: UserNotification[];
  filter: NotificationFilter;
}): ReactNode {
  const [local, setLocal] = useState(items);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const shown = useMemo(() => filterNotifications(local, filter), [filter, local]);

  const handleRead = useCallback(async (id: string) => {
    setBusyId(id);
    setError(undefined);
    try {
      const updated = await markNotificationRead(id);
      // 只採信伺服器回傳的結果，不做樂觀假存。
      setLocal((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : '標記已讀失敗，請重新載入後再試。'
      );
    } finally {
      setBusyId(undefined);
    }
  }, []);

  if (shown.length === 0) {
    return (
      <div className="nt-empty">
        <strong>
          {filter === 'unread' ? '沒有未讀通知' : '沒有符合條件的通知'}
        </strong>
        <p>新版本發布、版本撤下與緊急停用會出現在這裡。</p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p className="nt-error" role="alert">
          {error}
        </p>
      ) : null}
      {shown.map((item) => (
        <NotificationCard
          key={item.id}
          item={item}
          onRead={(id) => void handleRead(id)}
          busy={busyId === item.id}
        />
      ))}
      <p className="nt-rule">
        <strong>誰會收到新版本通知</strong>
        裝了同一套件其他版本的登入使用者。本次發布的版本還沒有安裝紀錄，已經在新版的人不需要被提醒；作者本人與匿名身分不通知——匿名身分沒有收件匣。
      </p>
    </>
  );
}

export function NotificationsPage(): ReactNode {
  const [filter, setFilter] = useState<NotificationFilter>('unread');

  // 一律取全部再於前端分流：切換分頁不重新請求，
  // 未讀計數也才能在標記已讀後立即反映。
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchNotifications(undefined, signal),
    []
  );
  const { pageState, reload } = usePageState(fetcher, [], {
    isEmpty: (items) => items.length === 0,
    emptyMessage: '目前沒有通知；版本發布、撤下與緊急停用會在這裡出現。'
  });

  return (
    <div className="nt">
      <header className="nt-page-head">
        <div>
          <h1>
            <BellIcon className="page-title-icon" />
            通知
          </h1>
          <p>平台內通知是第一期唯一渠道；IM 與郵件的外部推送屬第二期。</p>
        </div>
      </header>

      <div className="nt-filters" role="group" aria-label="通知篩選">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            data-active={filter === value ? '' : undefined}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="nt-panel">
        <PageStateView pageState={pageState} onRetry={reload}>
          {(items) => <NotificationList items={items} filter={filter} />}
        </PageStateView>
      </section>
    </div>
  );
}

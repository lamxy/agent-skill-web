// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ReactNode } from 'react';

import type { PageState } from '../api/types.js';
import './page-state.css';

interface Props<T> {
  pageState: PageState<T>;
  onRetry: () => void;
  /** loading 時顯示的骨架。未提供時使用通用骨架 */
  skeleton?: ReactNode;
  children: (data: T, unavailableSections: string[]) => ReactNode;
}

/**
 * 五態統一呈現。partial 時仍渲染主內容，並在上方標示缺失區段，
 * 因為主資料可用時不該讓整頁失效。
 */
export function PageStateView<T>({
  pageState,
  onRetry,
  skeleton,
  children
}: Props<T>): ReactNode {
  if (pageState.state === 'loading') {
    return (
      <div className="ps-loading" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">載入中</span>
        {skeleton ?? (
          <div className="ps-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    );
  }

  if (pageState.state === 'empty') {
    return (
      <div className="ps-empty" role="status" aria-live="polite">
        <p className="ps-empty-msg">{pageState.message}</p>
      </div>
    );
  }

  if (pageState.state === 'error') {
    return (
      <div className="ps-error" role="alert">
        <p className="ps-error-msg">{pageState.message}</p>
        {pageState.retryable ? (
          <button type="button" className="ps-retry" onClick={onRetry}>
            重新載入
          </button>
        ) : null}
      </div>
    );
  }

  const unavailable =
    pageState.state === 'partial' ? pageState.unavailableSections : [];

  return (
    <>
      {unavailable.length > 0 ? (
        <div className="ps-partial" role="status" aria-live="polite">
          <strong>部分資料暫時無法取得</strong>
          <p>以下區段缺失，其餘內容仍可查看：{unavailable.join('、')}。</p>
          <button type="button" className="ps-retry" onClick={onRetry}>
            重新載入
          </button>
        </div>
      ) : null}
      {children(pageState.data, unavailable)}
    </>
  );
}

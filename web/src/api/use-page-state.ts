// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from './client.js';
import type { PageState } from './types.js';

interface QueryOptions<T> {
  /** 判斷結果是否為空。回傳 true 時映射為 empty 而非 success */
  isEmpty?: (data: T) => boolean;
  /** empty 狀態顯示的訊息，須說明下一步而不只是「沒有資料」 */
  emptyMessage?: string;
  /**
   * 非核心區段失敗時的區段名稱。有值時映射為 partial，
   * 讓主資料仍可查看，並明確列出缺失區段。
   */
  unavailableSections?: (data: T) => string[];
}

/**
 * 把一次請求映射為五種頁面狀態。
 *
 * 契約邊界：後端只回傳 empty 或 success；loading、error 與 partial
 * 由此處依請求生命週期與部分失敗情形決定。詳見 docs/目錄頁狀態契約.md。
 */
export function usePageState<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: QueryOptions<T> = {}
): { pageState: PageState<T>; reload: () => void } {
  const [pageState, setPageState] = useState<PageState<T>>({ state: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  // 以 ref 保存回呼，避免呼叫端每次 render 產生新函式而重複發請求
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const controller = new AbortController();
    setPageState({ state: 'loading' });

    void (async () => {
      try {
        const data = await fetcherRef.current(controller.signal);
        if (controller.signal.aborted) return;

        const current = optionsRef.current;

        if (current.isEmpty?.(data)) {
          setPageState({
            state: 'empty',
            message: current.emptyMessage ?? '目前沒有符合條件的資料。'
          });
          return;
        }

        const unavailable = current.unavailableSections?.(data) ?? [];
        setPageState(
          unavailable.length > 0
            ? { state: 'partial', data, unavailableSections: unavailable }
            : { state: 'success', data }
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;

        setPageState(
          error instanceof ApiError
            ? {
                state: 'error',
                message: error.message,
                retryable: error.retryable
              }
            : {
                state: 'error',
                message: '發生未預期的錯誤，請重新載入。',
                retryable: true
              }
        );
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { pageState, reload };
}

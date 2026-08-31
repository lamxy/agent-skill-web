// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

import { fetchViewer, logout as requestLogout } from './identity.js';
import type { Viewer } from './types.js';

interface ViewerContextValue {
  viewer: Viewer | undefined;
  /** 首次解析身份期間為 true。用於避免導覽項閃爍。 */
  loading: boolean;
  /**
   * 身份查詢本身失敗（網路或平台異常）。與匿名不同：匿名是明確的
   * 「未登入」，這裡是「不知道是誰」，導覽因此不做任何角色假設。
   */
  failed: boolean;
  reload: () => void;
  logout: () => Promise<void>;
}

const ViewerContext = createContext<ViewerContextValue | undefined>(undefined);

export function ViewerProvider({ children }: { children: ReactNode }): ReactNode {
  const [viewer, setViewer] = useState<Viewer | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const next = await fetchViewer(controller.signal);
        if (controller.signal.aborted) return;
        setViewer(next);
        setFailed(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // 身份未知時不猜測，一律以最小權限呈現。
        setViewer(undefined);
        setFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const logout = useCallback(async () => {
    await requestLogout();
    // 重新解析而非直接清空：登出後後端會發匿名身份，
    // 讓匿名可用的頁面繼續正常運作。
    setReloadToken((token) => token + 1);
  }, []);

  const value = useMemo<ViewerContextValue>(
    () => ({ viewer, loading, failed, reload, logout }),
    [viewer, loading, failed, reload, logout]
  );

  return <ViewerContext value={value}>{children}</ViewerContext>;
}

export function useViewer(): ViewerContextValue {
  const context = useContext(ViewerContext);
  if (!context) {
    throw new Error('useViewer 必須在 ViewerProvider 之內使用');
  }
  return context;
}

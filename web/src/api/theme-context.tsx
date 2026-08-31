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

/**
 * 三態而非布林：system 表示跟隨作業系統，與使用者明確選了淺色是兩回事。
 * tokens.css 的深色同時定義在 prefers-color-scheme 與 data-theme 之下，
 * 因此 system 對應「不設 data-theme」，明確選擇才寫入屬性。
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'skill-platform-theme';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * 讀取已保存的偏好。隱私模式或停用網站資料時 localStorage 會直接拋出，
 * 此時退回 system，不讓偏好讀取失敗變成整頁白畫面。
 */
function readStoredPreference(): ThemePreference {
  // 伺服器端渲染沒有 window；連同隱私模式的存取例外一起吞掉，退回跟隨系統。
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** 伺服器端沒有 matchMedia，一律先當淺色，掛載後再由瀏覽器修正。 */
function prefersDarkNow(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
}

interface ThemeContextValue {
  preference: ThemePreference;
  /** 實際生效的外觀。preference 為 system 時由系統偏好決定。 */
  resolved: 'light' | 'dark';
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(prefersDarkNow);

  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  // 跟隨系統時，使用者在作業系統切換日夜要即時反映，不必重新整理。
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 無法保存時仍套用本次選擇，只是下次開啟會回到預設。
    }
  }, []);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference]
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme 必須在 ThemeProvider 之內使用');
  }
  return context;
}

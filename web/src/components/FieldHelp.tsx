// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import './field-help.css';

/**
 * 欄位說明。說明文字原本直接排在輸入框下方，長度不一會讓相鄰欄位
 * 的高度參差，窄屏更會被壓成一字寬的細長條；改成點擊標籤旁的圖標
 * 才展開，表單因此只剩「標籤 + 輸入框」兩列，對齊與行動端適配都單純。
 *
 * 用按鈕而非 hover 提示：觸控裝置沒有 hover，說明必須點得開。
 */
export function FieldHelp({ children }: { children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <span className="field-help" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="field-help-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="顯示欄位說明"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle
            cx="8"
            cy="8"
            r="6.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M6.3 6.1a1.8 1.8 0 1 1 2.3 1.9c-.4.15-.6.5-.6.95v.35"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.4" r="0.75" fill="currentColor" />
        </svg>
      </button>
      {/*
        說明文字一律留在 DOM 內：收合時以 sr-only 隱藏，螢幕閱讀器與
        aria-controls 仍讀得到，只有視覺上需要點開。若改成收合時不渲染，
        說明就只剩滑鼠使用者能取得。
      */}
      <span
        className={open ? 'field-help-panel' : 'sr-only'}
        id={panelId}
        role="note"
      >
        {children}
      </span>
    </span>
  );
}

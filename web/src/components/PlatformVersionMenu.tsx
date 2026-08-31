// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { checkPlatformVersion, fetchPlatformVersions } from '../api/platform.js';
import type { PlatformVersion, PlatformVersionAvailability } from '../api/types.js';
import './platform-version-menu.css';

/**
 * 頂欄的平台版本選單。版本清單與開放狀態都來自後端的平台版本管理表，
 * 前端不寫死任何版本號——新增版本或開放既有版本只需改資料，不必改前端。
 *
 * 點選版本不會切換平台，而是查詢該版本是否開放並以提示彈框回覆；
 * 真正的版本切換要等到有第二個開放版本時才有意義。
 */
export function PlatformVersionMenu(): ReactNode {
  const [versions, setVersions] = useState<PlatformVersion[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<PlatformVersionAvailability | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchPlatformVersions(controller.signal)
      .then((data) => {
        setVersions(data.versions);
        setCurrent(data.currentVersion);
      })
      /* 版本選單是輔助資訊，取不到時整個入口不顯示，不打斷主要操作 */
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

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

  const pick = useCallback((version: string) => {
    setOpen(false);
    checkPlatformVersion(version)
      .then(setNotice)
      .catch(() => undefined);
  }, []);

  // 清單尚未載入或為空時不佔位，避免頂欄在載入過程中跳動。
  if (versions.length === 0) return null;

  const label = current ?? versions[0]?.version ?? '';

  return (
    <>
      <div className="pvm" ref={containerRef}>
        <button
          type="button"
          ref={triggerRef}
          className="pvm-trigger"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`平台版本 ${label}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="pvm-current">{label}</span>
          <svg
            className="pvm-arrow"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="m4 6.5 4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open ? (
          <ul className="pvm-list" role="listbox" aria-label="平台版本">
            {versions.map((item) => (
              <li key={item.version}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.version === current}
                  data-selected={item.version === current ? '' : undefined}
                  /* 未開放的版本仍可點選：點下去正是為了看到「暫未開放」的說明 */
                  data-locked={item.isAvailable ? undefined : ''}
                  onClick={() => pick(item.version)}
                >
                  <span className="pvm-version">{item.version}</span>
                  {item.isAvailable ? null : (
                    <span className="pvm-tag">暫未開放</span>
                  )}
                  {/* 對勾標出目前使用的版本，形狀與 Select 的選中標記一致 */}
                  {item.version === current ? (
                    <svg
                      className="pvm-check"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="m3.5 8.5 3 3 6-6.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {notice ? (
        <div
          className="pvm-dialog-mask"
          role="presentation"
          onClick={() => setNotice(null)}
        >
          <div
            className="pvm-dialog"
            role="alertdialog"
            aria-labelledby="pvm-dialog-title"
            aria-describedby="pvm-dialog-body"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="pvm-dialog-title">{notice.version}</h2>
            <p id="pvm-dialog-body">
              {notice.message}
              {notice.note ? <span className="pvm-dialog-note">{notice.note}</span> : null}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setNotice(null)}>
              知道了
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

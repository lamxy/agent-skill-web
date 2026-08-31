// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import './select.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * 自訂下拉。原生 <select> 展開後的選項清單由作業系統繪製，
 * CSS 只能改到收合狀態，因此圓角、間距與 hover 高亮一律無法套用。
 * 這裡用 button + listbox 重建，讓展開清單也跟著設計系統與日夜主題走。
 *
 * 無障礙行為對齊原生：Enter/Space/上下鍵開啟，開啟後上下鍵移動、
 * Enter 選取、Esc 關閉並把焦點還給觸發鍵，Home/End 跳到首末項。
 */
export function Select({
  value,
  options,
  onChange,
  id,
  disabled = false,
  placeholder = '請選擇',
  ariaLabel
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  /*
   * 展開方向。清單一律優先向下，但靠近視窗底部時下方放不下，
   * 選項會被視窗邊緣或固定頁腳截斷，此時改為向上展開。
   */
  const [dropUp, setDropUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const listId = `${generatedId}-listbox`;

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setActiveIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /*
   * 依觸發鍵在視窗中的位置決定展開方向。在 setOpen 之前算好，
   * 清單才不會先向下畫出來再翻上去。
   *
   * 清單高度上限 264px（見 select.css 的 max-height）加上 6px 間距；
   * 下方不夠而上方夠時才翻轉，兩邊都不夠就維持向下，由清單自身捲動。
   */
  const resolveDirection = useCallback((): boolean => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const needed = 270;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    return below < needed && above > below;
  }, []);

  // 開啟時把高亮落在目前選中項，讓鍵盤操作從當前值開始移動。
  const openList = useCallback(() => {
    if (disabled) return;
    setDropUp(resolveDirection());
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [disabled, resolveDirection, selectedIndex]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        close(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [close, open]);

  // 高亮移出可視範圍時捲動跟上，長清單才不會「跳不到」選中項。
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    const item = list?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const step = useCallback(
    (from: number, direction: 1 | -1): number => {
      const total = options.length;
      if (total === 0) return -1;
      let next = from;
      // 跳過停用項；最多繞一圈避免全部停用時無限迴圈。
      for (let i = 0; i < total; i += 1) {
        next = (next + direction + total) % total;
        if (!options[next]?.disabled) return next;
      }
      return from;
    },
    [options]
  );

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      close(true);
    },
    [close, onChange, options]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (disabled) return;

      if (!open) {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          openList();
        }
        return;
      }

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          close(true);
          break;
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((current) => step(current < 0 ? -1 : current, 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((current) => step(current < 0 ? 0 : current, -1));
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(step(-1, 1));
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(step(0, -1));
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          commit(activeIndex);
          break;
        case 'Tab':
          close(false);
          break;
        default:
          break;
      }
    },
    [activeIndex, close, commit, disabled, open, openList, step]
  );

  return (
    <div className="ui-select" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        {...(id ? { id } : {})}
        className="ui-select-trigger"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className={selected ? 'ui-select-value' : 'ui-select-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className="ui-select-arrow"
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
        <div
          className="ui-select-list"
          data-drop-up={dropUp ? '' : undefined}
          id={listId}
          role="listbox"
          ref={listRef}
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled ? true : undefined}
              className="ui-select-option"
              data-active={index === activeIndex ? '' : undefined}
              data-selected={option.value === value ? '' : undefined}
              data-disabled={option.disabled ? '' : undefined}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              /*
               * 在 mousedown 提交而非 click。commit 會把焦點送回觸發鍵，
               * 若等到 click 才處理，這次點擊的後續事件會落在已經聚焦的
               * 觸發鍵上，把剛關閉的清單重新開啟——欄位越寬越容易發生，
               * 因為觸發鍵與選項在水平方向完全重疊。
               *
               * preventDefault 一併擋掉瀏覽器預設的焦點轉移。
               */
              onMouseDown={(event) => {
                event.preventDefault();
                commit(index);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <svg
                  className="ui-select-check"
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
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

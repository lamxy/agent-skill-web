// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ReactNode } from 'react';

import type { VersionLifecycle } from '../api/types.js';
import './primitives.css';

type ChipTone = 'ok' | 'warn' | 'stop' | 'neutral' | 'seal';

export function Chip({
  tone = 'neutral',
  mono = false,
  children
}: {
  tone?: ChipTone;
  mono?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <span className={`chip chip-${tone}${mono ? ' mono' : ''}`}>{children}</span>
  );
}

const LIFECYCLE_LABEL: Record<VersionLifecycle, string> = {
  draft: '草稿',
  validating: '驗證中',
  validation_failed: '驗證失敗',
  review_required: '待審核',
  published: '已發布',
  deprecated: '已淘汰',
  delisted: '已撤下',
  emergency_disabled: '緊急停用'
};

const LIFECYCLE_TONE: Record<VersionLifecycle, ChipTone> = {
  draft: 'neutral',
  validating: 'neutral',
  validation_failed: 'stop',
  review_required: 'warn',
  published: 'ok',
  deprecated: 'neutral',
  delisted: 'neutral',
  emergency_disabled: 'stop'
};

/**
 * 狀態一律使用 VersionLifecycle 的真實值。
 * 介面禁止引入「可信等級」一類後端不存在的概念。
 */
export function LifecycleChip({
  lifecycle
}: {
  lifecycle: VersionLifecycle;
}): ReactNode {
  return (
    <Chip tone={LIFECYCLE_TONE[lifecycle]}>{LIFECYCLE_LABEL[lifecycle]}</Chip>
  );
}

/**
 * 成功率沒有數據時顯示「尚無數據」。
 * 顯示 0% 會被誤讀為「試過但全部失敗」，與「還沒有人裝過」語意完全不同。
 */
export function SuccessRate({ value }: { value: number | null }): ReactNode {
  if (value === null) {
    return <span className="rate-none">尚無數據</span>;
  }
  return <span className="rate tabular">{Math.round(value * 100)}%</span>;
}

export function Button({
  variant = 'ghost',
  type = 'button',
  disabled = false,
  form,
  ariaDescribedBy,
  onClick,
  children
}: {
  variant?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  /* 關聯到頁面上某個 <form> 的 id。提交鍵移到表單之外時需要 */
  form?: string;
  ariaDescribedBy?: string;
  onClick?: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type={type}
      className={`btn btn-${variant}`}
      disabled={disabled}
      {...(form ? { form } : {})}
      {...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {})}
      {...(onClick ? { onClick } : {})}
    >
      {children}
    </button>
  );
}

// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../api/client.js';
import { submitFeedback } from '../api/experience.js';
import type { FeedbackIssueCategory } from '../api/types.js';
import { Select } from '../components/Select.js';
import {
  FEEDBACK_CATEGORY_LABEL,
  SATISFACTION_LABEL,
  validateFeedback,
  type FeedbackFormValue
} from './experience-model.js';
import './feedback.css';

const CATEGORIES = Object.entries(FEEDBACK_CATEGORY_LABEL) as Array<
  [FeedbackIssueCategory, string]
>;

const EMPTY: FeedbackFormValue = {
  satisfaction: null,
  issueCategory: '',
  detail: '',
  needsHumanSupport: false
};

export function FeedbackSection({
  packageId,
  version
}: {
  packageId: string;
  version: string;
}): ReactNode {
  const [value, setValue] = useState<FeedbackFormValue>(EMPTY);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = useCallback(async () => {
    // 前端先擋掉必然被後端拒絕的送出，不發無意義的請求。
    const invalid = validateFeedback(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await submitFeedback(packageId, {
        version,
        satisfaction: value.satisfaction!,
        issueCategory: value.issueCategory as FeedbackIssueCategory,
        detail: value.detail.trim(),
        needsHumanSupport: value.needsHumanSupport
      });
      setDone(true);
      setValue(EMPTY);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : '送出反饋失敗，請稍後再試。'
      );
    } finally {
      setSending(false);
    }
  }, [packageId, value, version]);

  if (done) {
    return (
      <section className="pd-card fb">
        <h2 className="pd-card-h">回報使用問題</h2>
        <div className="fb-done" role="status">
          <strong>已收到你的反饋</strong>
          <p>維護者會透過支援渠道回覆。此反饋不會公開顯示給其他使用者。</p>
          <button type="button" className="btn btn-ghost" onClick={() => setDone(false)}>
            再回報一則
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="pd-card fb">
      <h2 className="pd-card-h">
        回報使用問題
        <span className="fb-version mono">{version}</span>
      </h2>

      {error ? (
        <p className="fb-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="fb-form">
        <fieldset className="fb-field">
          <legend>整體滿意度</legend>
          <div className="fb-sat">
            {[1, 2, 3, 4, 5].map((score) => (
              <button
                key={score}
                type="button"
                aria-pressed={value.satisfaction === score}
                data-active={value.satisfaction === score ? '' : undefined}
                onClick={() => setValue((current) => ({ ...current, satisfaction: score }))}
              >
                <b>{score}</b>
                <small>{SATISFACTION_LABEL[score]}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="fb-field">
          <span>問題分類</span>
          <Select
            value={value.issueCategory}
            ariaLabel="問題分類"
            onChange={(next) =>
              setValue((current) => ({
                ...current,
                issueCategory: next as FeedbackIssueCategory | ''
              }))
            }
            options={[
              { value: '', label: '請選擇' },
              ...CATEGORIES.map(([key, label]) => ({ value: key, label }))
            ]}
          />
        </label>

        <label className="fb-field">
          <span>詳細描述</span>
          <textarea
            value={value.detail}
            placeholder="請描述遇到的情況。附上錯誤碼與作業系統會讓維護者更快定位。"
            onChange={(event) =>
              setValue((current) => ({ ...current, detail: event.target.value }))
            }
          />
        </label>

        <label className="fb-check">
          <input
            type="checkbox"
            checked={value.needsHumanSupport}
            onChange={(event) =>
              setValue((current) => ({
                ...current,
                needsHumanSupport: event.target.checked
              }))
            }
          />
          <span>
            我需要人工協助
            <small>勾選後這則反饋會進入維護者的待處理清單。</small>
          </span>
        </label>
      </div>

      <div className="fb-bar">
        <small>已登入時記錄你的 UID；未登入時記錄匿名 UUID。</small>
        <button
          type="button"
          className="btn btn-primary"
          disabled={sending}
          onClick={() => void handleSubmit()}
        >
          {sending ? '送出中…' : '送出反饋'}
        </button>
      </div>
    </section>
  );
}

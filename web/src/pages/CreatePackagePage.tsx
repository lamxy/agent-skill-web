// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { createPackage } from '../api/publish.js';
import { useProvideFooterAction } from '../api/footer-action-context.js';
import { useViewer } from '../api/viewer-context.js';
import { Select } from '../components/Select.js';
import { PublishIcon } from '../components/icons.js';
import { Button } from '../components/primitives.js';
import {
  buildCreatePackagePayload,
  describeCreateFailure,
  emptyCreateDraft,
  validateCreateDraft
} from './create-package-model.js';
import type { CreatePackageDraft, CreatePackageErrors } from './create-package-model.js';
import { CATEGORY_LABEL } from './catalog-taxonomy.js';
import './publish.css';

function FieldError({ id, message }: { id: string; message: string | undefined }): ReactNode {
  return message ? <small id={id} className="pub-field-error">{message}</small> : null;
}

export function CreatePackagePage(): ReactNode {
  const navigate = useNavigate();
  const { viewer } = useViewer();
  const teamOptions =
    viewer?.kind === 'authenticated' ? viewer.teamIds : [];
  const [draft, setDraft] = useState<CreatePackageDraft>(emptyCreateDraft);
  const [errors, setErrors] = useState<CreatePackageErrors>({});
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /*
   * 身份是非同步解析的，草稿初始化時還沒有團隊可填。
   * 只在使用者尚未自行選過時補上預設值，避免覆寫他的選擇。
   */
  const firstTeam = teamOptions[0];
  useEffect(() => {
    if (!firstTeam) return;
    setDraft((current) =>
      current.ownerTeam ? current : { ...current, ownerTeam: firstTeam }
    );
  }, [firstTeam]);

  const update = <K extends keyof CreatePackageDraft>(
    key: K,
    value: CreatePackageDraft[K]
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = validateCreateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setMessage('請先修正標示的欄位。');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const created = await createPackage(buildCreatePackagePayload(draft));
      /*
       * 建立後直接進入該技能的版本頁，而不是回清單。
       * 技能沒有版本就不能送審，停在清單等於把必要的下一步藏起來。
       */
      void navigate(`/publish/${encodeURIComponent(created.packageId)}`, {
        replace: true
      });
    } catch (error) {
      setMessage(describeCreateFailure(error));
      setSubmitting(false);
    }
  };

  /*
   * 主要動作交給全站頁腳的固定欄。提交鍵因此位於 <form> 之外，
   * 改用 form 屬性關聯回表單，原本的 onSubmit 驗證流程不受影響。
   */
  useProvideFooterAction(
    () => ({
      hint: message ? (
        <span className="pub-message" role="status">
          {message}
        </span>
      ) : (
        '建立後接著填寫第一個版本。'
      ),
      content: (
        <>
          <Link className="btn btn-ghost" to="/publish">
            取消
          </Link>
          <Button
            type="submit"
            form="cp-form"
            variant="primary"
            disabled={submitting}
          >
            {submitting ? '建立中…' : '建立技能並填寫版本'}
          </Button>
        </>
      )
    }),
    [message, submitting]
  );

  return (
    <div className="pub">
      <header className="pub-head">
        <h1>
          <PublishIcon className="page-title-icon" />
          發布新技能
        </h1>
        <p>
          建立一個平台上尚不存在的技能。基本資料只在此填寫一次，
          建立後接著為它填寫第一個版本；送審通過後技能會自動上架，對員工可見。
        </p>
      </header>

      <form id="cp-form" className="pub-panel" onSubmit={(event) => void submit(event)}>
        <div className="pub-panel-head">
          <div>
            <h2>技能基本資料</h2>
            <p>識別碼建立後不可修改，會出現在腳本檔名與安裝路徑中。</p>
          </div>
        </div>

        <div className="pub-grid-two">
          <div>
            <label htmlFor="cp-id">
              技能識別碼<span aria-hidden="true"> *</span>
            </label>
            <input
              id="cp-id"
              value={draft.packageId}
              maxLength={200}
              required
              aria-invalid={Boolean(errors.packageId)}
              aria-describedby={errors.packageId ? 'cp-id-error' : 'cp-id-help'}
              onChange={(event) => update('packageId', event.target.value)}
              placeholder="例如 code-review"
            />
            <FieldError id="cp-id-error" message={errors.packageId} />
            {errors.packageId ? null : (
              <small id="cp-id-help">建立後不可修改。小寫英文、數字與 . _ - </small>
            )}
          </div>
          <div>
            <label htmlFor="cp-name">
              技能名稱<span aria-hidden="true"> *</span>
            </label>
            <input
              id="cp-name"
              value={draft.name}
              maxLength={200}
              required
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => update('name', event.target.value)}
              placeholder="例如 程式碼審查助手"
            />
            <FieldError id="cp-name-error" message={errors.name} />
          </div>
        </div>

        <label htmlFor="cp-purpose">
          用途說明<span aria-hidden="true"> *</span>
        </label>
        <textarea
          id="cp-purpose"
          rows={3}
          maxLength={5000}
          required
          value={draft.purpose}
          aria-invalid={Boolean(errors.purpose)}
          onChange={(event) => update('purpose', event.target.value)}
          placeholder="員工在技能池看到的說明，描述這個技能解決什麼問題。"
        />
        <FieldError id="cp-purpose-error" message={errors.purpose} />

        <div className="pub-grid-two">
          <div>
            <label htmlFor="cp-team">
              所屬團隊<span aria-hidden="true"> *</span>
            </label>
            {/*
              從自己隸屬的團隊中選，不讓人自由輸入：伺服器只接受自己
              有維護權限的團隊，手打一個不屬於自己的名稱必定被拒，
              而使用者無從得知自己在後端叫什麼團隊名。
            */}
            {teamOptions.length > 0 ? (
              <Select
                id="cp-team"
                value={draft.ownerTeam}
                onChange={(value) => update('ownerTeam', value)}
                options={teamOptions.map((team) => ({ value: team, label: team }))}
              />
            ) : (
              <input
                id="cp-team"
                value={draft.ownerTeam}
                maxLength={200}
                required
                aria-invalid={Boolean(errors.ownerTeam)}
                aria-describedby={errors.ownerTeam ? 'cp-team-error' : 'cp-team-help'}
                onChange={(event) => update('ownerTeam', event.target.value)}
              />
            )}
            <FieldError id="cp-team-error" message={errors.ownerTeam} />
            {errors.ownerTeam ? null : (
              <small id="cp-team-help">
                {teamOptions.length > 0
                  ? '技能屬於團隊資產，同團隊成員都能維護。'
                  : '你的帳號沒有任何團隊，請聯絡管理員確認組織資料。'}
              </small>
            )}
          </div>
          <div>
            <label htmlFor="cp-category">分類</label>
            {/*
              固定選項而非自由文字：舊資料同時存在 backend 與 後端，
              讓每個人自己填分類正是列表篩選失效的原因。
            */}
            <Select
              id="cp-category"
              value={draft.categoryCode}
              onChange={(value) =>
                update('categoryCode', value as CreatePackageDraft['categoryCode'])
              }
              options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({
                value,
                label
              }))}
            />
          </div>
        </div>

        <div className="pub-grid-two">
          <div>
            <label htmlFor="cp-type">類型</label>
            <Select
              id="cp-type"
              value={draft.type}
              onChange={(value) => update('type', value as CreatePackageDraft['type'])}
              options={[
                { value: 'skill', label: 'Skill' },
                { value: 'tool', label: 'Tool' }
              ]}
            />
          </div>
          <div>
            <label htmlFor="cp-visibility">可見性</label>
            <Select
              id="cp-visibility"
              value={draft.visibility}
              onChange={(value) =>
                update('visibility', value as CreatePackageDraft['visibility'])
              }
              options={[
                { value: 'internal', label: 'internal — 僅登入員工可見' },
                { value: 'public', label: 'public — 未登入訪客也可見' }
              ]}
            />
          </div>
        </div>

        {/*
          發布者類型與名稱已移除：技能屬團隊資產，發布者即所屬團隊，
          由後端從 ownerTeam 推導，不需要再讓使用者填一次同樣的資訊。
        */}
        <div className="pub-grid-two">
          <div>
            <label htmlFor="cp-origin">來源</label>
            <Select
              id="cp-origin"
              value={draft.source}
              onChange={(value) =>
                update('source', value as CreatePackageDraft['source'])
              }
              options={[
                { value: 'custom', label: '自定義 — 內部自行開發' },
                { value: 'opensource', label: '開源 — 來自公開開源專案' }
              ]}
            />
          </div>
          <div>
            <label htmlFor="cp-source">來源位址</label>
            <input
              id="cp-source"
              value={draft.sourceUri}
              maxLength={2000}
              aria-invalid={Boolean(errors.sourceUri)}
              onChange={(event) => update('sourceUri', event.target.value)}
              placeholder="https://git.example/code-review"
            />
            <FieldError id="cp-source-error" message={errors.sourceUri} />
          </div>
        </div>

        <div className="pub-grid-two">
          <div>
            <label htmlFor="cp-license">授權條款</label>
            <input
              id="cp-license"
              value={draft.license}
              maxLength={200}
              aria-invalid={Boolean(errors.license)}
              onChange={(event) => update('license', event.target.value)}
            />
            <FieldError id="cp-license-error" message={errors.license} />
          </div>
        </div>
      </form>
    </div>
  );
}

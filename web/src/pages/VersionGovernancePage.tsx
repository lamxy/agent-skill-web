// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { deprecateVersion, emergencyDisableVersion, delistVersion } from '../api/admin.js';
import { fetchPackageDetail, searchPackages } from '../api/catalog.js';
import type { PackageDetail, PackageVersionSummary } from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { Button, LifecycleChip } from '../components/primitives.js';
import { AdminHeader } from './AdminNav.js';
import {
  GOVERNANCE_ACTIONS,
  availableGovernanceActions,
  governanceActionMeta,
  governancePackageOptions,
  governanceUnavailableReason
} from './admin-model.js';
import type { GovernanceAction } from './admin-model.js';
import './admin.css';

function GovernanceConsole({ packageId }: { packageId: string }): ReactNode {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchPackageDetail(packageId, signal),
    [packageId]
  );
  const { pageState, reload } = usePageState(fetcher, [packageId]);
  const [version, setVersion] = useState('');
  const [action, setAction] = useState<GovernanceAction>('delist');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const submit = (
    event: FormEvent<HTMLFormElement>,
    data: PackageDetail,
    effectiveAction: GovernanceAction
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedVersion = version || data.versions[0]?.version || '';
    const reasonCode = String(form.get('reasonCode') ?? '');
    const reasonDetail = String(form.get('reasonDetail') ?? '');
    const meta = governanceActionMeta(effectiveAction);
    if (!selectedVersion) return;
    if (meta.reasonRequired && !reasonCode.trim()) return;
    if (
      !window.confirm(
        `確定要${meta.label} ${data.name} ${selectedVersion}？此操作不可逆，無法恢復為已發布。`
      )
    ) {
      return;
    }

    setSaving(true);
    setMessage('');
    /*
     * 棄用的 payload 形狀與另外兩者不同：只收單一 reason，
     * 沒有 reasonCode 與 effectiveAt。此處把兩個輸入併為一段說明。
     */
    const mutation =
      effectiveAction === 'deprecate'
        ? deprecateVersion(
            data.packageId,
            selectedVersion,
            [reasonCode, reasonDetail].map((part) => part.trim()).filter(Boolean).join('：')
          )
        : effectiveAction === 'delist'
          ? delistVersion(data.packageId, selectedVersion, { reasonCode, reasonDetail })
          : emergencyDisableVersion(data.packageId, selectedVersion, { reasonCode, reasonDetail });
    void mutation
      .then((updated: PackageVersionSummary) => {
        setMessage(`伺服器已更新為 ${updated.lifecycle}。`);
        reload();
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : '版本治理操作失敗。')
      )
      .finally(() => setSaving(false));
  };

  return (
    <PageStateView pageState={pageState} onRetry={reload}>
      {(data) => {
        const selectedVersion = version || data.versions[0]?.version || '';
        const selected = data.versions.find((item) => item.version === selectedVersion);
        const available = selected ? availableGovernanceActions(selected.lifecycle) : [];
        /*
         * 切換版本後原本選定的處置可能已不適用（例如從 published 換到
         * deprecated，棄用就不再是選項）。回退到第一個可用處置，
         * 否則會送出必被 409 擋下的轉換。
         */
        const effectiveAction =
          available.includes(action) ? action : available[0] ?? action;
        const activeMeta = governanceActionMeta(effectiveAction);
        return (
          <div className="adm-governance-grid">
            <section className="adm-panel adm-version-list">
              <div className="adm-panel-head"><div><h2>{data.name}</h2><p className="mono">{data.packageId}</p></div><span>{data.ownerTeam}</span></div>
              {data.versions.length === 0 ? (
                <p className="adm-empty-inline">此套件目前沒有可治理的版本。</p>
              ) : data.versions.map((item) => (
                <button key={item.id} type="button" className="adm-version-row" aria-pressed={item.version === selectedVersion} data-active={item.version === selectedVersion ? '' : undefined} onClick={() => setVersion(item.version)}>
                  <span><strong className="mono">{item.version}</strong><small>{new Date(item.updatedAt).toLocaleString('zh-TW')}</small></span>
                  <LifecycleChip lifecycle={item.lifecycle} />
                </button>
              ))}
            </section>

            <form className="adm-panel adm-governance-form" onSubmit={(event) => submit(event, data, effectiveAction)}>
              <h2>下架處置</h2>
              <p>目標版本 <strong className="mono">{selected?.version ?? '尚未選擇'}</strong></p>
              {selected && available.length === 0 ? (
                <p className="adm-empty-inline">{governanceUnavailableReason(selected.lifecycle)}</p>
              ) : (
                <>
                  <fieldset>
                    <legend>處置方式</legend>
                    {GOVERNANCE_ACTIONS.map((meta) => {
                      const enabled = available.includes(meta.action);
                      return (
                        <label
                          key={meta.action}
                          className={`adm-radio${meta.adminOnly ? ' adm-radio-danger' : ''}`}
                          data-off={enabled ? undefined : ''}
                        >
                          <input
                            type="radio"
                            name="action"
                            checked={effectiveAction === meta.action}
                            disabled={!enabled}
                            onChange={() => setAction(meta.action)}
                          />
                          <span>
                            <strong>{meta.label}</strong>
                            <small>
                              {enabled
                                ? meta.hint
                                : `目前狀態（${selected?.lifecycle ?? '—'}）不允許此處置。`}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                  {/*
                    三種處置對員工的效果完全相同，且都不可逆。
                    不寫明的話使用者會以為「棄用」比「撤下」溫和、事後可反悔。
                  */}
                  <p className="adm-governance-warn">
                    三者都會立即停止腳本生成，並讓版本從技能池消失，效果相同；
                    差別在稽核語意與執行權限。<strong>都不可逆，無法恢復為已發布。</strong>
                  </p>
                  <label>
                    原因代碼{activeMeta.reasonRequired ? '' : '（選填）'}
                    <input
                      name="reasonCode"
                      required={activeMeta.reasonRequired}
                      maxLength={200}
                      placeholder={
                        effectiveAction === 'deprecate'
                          ? 'superseded'
                          : effectiveAction === 'delist'
                            ? 'policy_change'
                            : 'critical_issue'
                      }
                    />
                  </label>
                  <label>補充說明（選填）<textarea name="reasonDetail" maxLength={5000} rows={5} /></label>
                  {message ? <p className="adm-message" role="status">{message}</p> : null}
                  <Button type="submit" variant="danger" disabled={!selected || saving}>
                    {saving ? '提交中…' : activeMeta.submitLabel}
                  </Button>
                </>
              )}
            </form>
          </div>
        );
      }}
    </PageStateView>
  );
}

export function VersionGovernancePage(): ReactNode {
  const [packageId, setPackageId] = useState('');
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      searchPackages({ limit: 100, sort: 'name_asc' }, signal),
    []
  );
  const { pageState, reload } = usePageState(fetcher, [], {
    isEmpty: (data) => data.items.length === 0,
    emptyMessage: '目前沒有可治理的已發布套件。'
  });
  // 自訂下拉不是原生表單控制項，值取自 state 而非 FormData。
  const [packageIdDraft, setPackageIdDraft] = useState('');
  const locate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPackageId(packageIdDraft.trim());
  };

  return (
    <div className="adm">
      <AdminHeader title="版本治理" description="先定位套件，再針對伺服器回傳的真實版本生命週期執行不可逆操作。" />
      <PageStateView pageState={pageState} onRetry={reload}>
        {(data) => (
          <form className="adm-locate" onSubmit={locate}>
            <label>
              <span className="label-text">可治理套件</span>
              <Select
                value={packageIdDraft}
                onChange={setPackageIdDraft}
                placeholder="選擇真實套件"
                options={governancePackageOptions(data.items)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={!packageIdDraft}>載入版本</Button>
          </form>
        )}
      </PageStateView>
      {packageId ? <GovernanceConsole key={packageId} packageId={packageId} /> : <div className="adm-start-state"><strong>尚未選擇套件</strong><p>從 Catalog 的真實套件清單選擇後載入版本詳情。</p></div>}
    </div>
  );
}

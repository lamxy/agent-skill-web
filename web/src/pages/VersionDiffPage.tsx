// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { ApiError } from '../api/client.js';
import { fetchVersionDiff } from '../api/experience.js';
import type {
  ScriptOptionDefinition,
  ScriptTargetDiff,
  ScriptTargetDiffSide,
  VersionDiff
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { Chip } from '../components/primitives.js';
import { CHANGE_LABEL, diffFlags, hasOptionChanges } from './experience-model.js';
import './version-diff.css';

const DIRECTION_LABEL = {
  upgrade: '升級',
  downgrade: '降級',
  same: '相同版本'
} as const;

function DiffSide({
  side,
  label
}: {
  side: ScriptTargetDiffSide | undefined;
  label: string;
}): ReactNode {
  if (!side) {
    return (
      <div className="vd-side">
        <span>{label}</span>
        <b className="vd-absent">不存在</b>
      </div>
    );
  }
  return (
    <div className="vd-side">
      <span>
        {label} v{side.scriptVersion}
      </span>
      <b className="mono">{side.contentDigest}</b>
    </div>
  );
}

function OptionRow({
  mark,
  tone,
  option
}: {
  mark: string;
  tone: 'add' | 'del' | 'mod';
  option: ScriptOptionDefinition;
}): ReactNode {
  return (
    <div className="vd-opt">
      <span className={`vd-opt-mark vd-opt-${tone}`} aria-hidden="true">
        {mark}
      </span>
      <span className="vd-opt-body">
        <code className="mono">{option.name}</code>
        <small>
          {option.description}
          {option.choices?.length ? ` · ${option.choices.join(' / ')}` : ''}
        </small>
      </span>
    </div>
  );
}

function TargetDiff({ diff }: { diff: ScriptTargetDiff }): ReactNode {
  return (
    <article className="vd-target">
      <header className="vd-target-head">
        <b className="mono">
          {diff.targetOs} × {diff.clientRuntime}
        </b>
        <Chip
          tone={
            diff.change === 'added'
              ? 'ok'
              : diff.change === 'removed'
                ? 'stop'
                : diff.change === 'changed'
                  ? 'warn'
                  : 'neutral'
          }
        >
          {CHANGE_LABEL[diff.change]}
        </Chip>
      </header>

      {diff.change === 'unchanged' ? null : (
        <ul className="vd-flags">
          {diffFlags(diff).map((flag) => (
            <li key={flag.label} data-changed={flag.changed ? '' : undefined}>
              {flag.label}
              <span className="sr-only">{flag.changed ? '：已變更' : '：未變更'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="vd-digest">
        <DiffSide side={diff.current} label="目前" />
        <span className="vd-arrow" aria-hidden="true">
          →
        </span>
        <DiffSide side={diff.target} label="目標" />
      </div>

      {hasOptionChanges(diff) ? (
        <div className="vd-opts">
          {diff.addedOptions.map((option) => (
            <OptionRow key={`a-${option.name}`} mark="+" tone="add" option={option} />
          ))}
          {diff.removedOptions.map((option) => (
            <OptionRow key={`r-${option.name}`} mark="−" tone="del" option={option} />
          ))}
          {diff.changedOptions.map((change) => (
            <OptionRow
              key={`c-${change.name}`}
              mark="~"
              tone="mod"
              option={change.target}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ResidualNote({ diff }: { diff: VersionDiff }): ReactNode {
  if (diff.residualEffects.introduced) {
    return (
      <p>
        目標版本<strong>新增</strong>了殘留副作用：解除安裝後仍會保留部分內容，需要手動清理。完整清理步驟在安裝頁顯示。
      </p>
    );
  }
  if (diff.residualEffects.target) {
    return <p>兩個版本都有殘留副作用，本次沒有新增。</p>;
  }
  return <p>兩個版本都沒有殘留副作用。</p>;
}

function DiffView({ diff }: { diff: VersionDiff }): ReactNode {
  const [acknowledged, setAcknowledged] = useState(false);
  const canContinue = !diff.requiresReapproval || acknowledged;
  const installPath = `/packages/${encodeURIComponent(diff.packageId)}/versions/${encodeURIComponent(diff.targetVersion)}/install`;

  return (
    <div className="vd-body">
      <div className="vd-shift">
        <div className="vd-ver">
          <span>目前版本</span>
          <b className="mono">{diff.currentVersion}</b>
        </div>
        <span className="vd-arrow" aria-hidden="true">
          →
        </span>
        <div className="vd-ver">
          <span>目標版本</span>
          <b className="mono">{diff.targetVersion}</b>
        </div>
        <span className="vd-dir">{DIRECTION_LABEL[diff.direction]}</span>
      </div>

      {diff.requiresReapproval ? (
        <section className="vd-banner" role="alert">
          <h2>這次升級需要你重新確認</h2>
          <p>命令、選項或殘留副作用已改變，你上次安裝時的判斷依據不再成立。</p>
          <ul>
            {diff.reapprovalReasons.map((reason) => (
              <li key={`${reason.code}-${reason.targetOs ?? ''}-${reason.clientRuntime ?? ''}`}>
                {reason.message}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="vd-banner vd-banner-calm" role="status">
          <h2>沒有需要重新確認的變更</h2>
          <p>命令、選項與殘留副作用皆未改變。</p>
        </section>
      )}

      <div className="vd-grid">
        <section className="vd-panel">
          <h2 className="vd-panel-h">
            安裝目標逐項差異
            <small>{diff.scriptTargets.length} 個組合</small>
          </h2>
          {diff.scriptTargets.length === 0 ? (
            <p className="vd-none">兩個版本都沒有已保存的安裝目標。</p>
          ) : (
            diff.scriptTargets.map((target) => (
              <TargetDiff
                key={`${target.targetOs}-${target.clientRuntime}`}
                diff={target}
              />
            ))
          )}
          <p className="vd-rule">
            <strong>為什麼看不到命令內容</strong>
            中部命令是平台內部腳本片段，不是升級決策依據。此頁只顯示「哪裡變了」；要看會在你機器上執行的完整腳本，請到安裝頁。
          </p>
        </section>

        <aside className="vd-side-col">
          {diff.releaseNotes ? (
            <section className="vd-panel">
              <h2 className="vd-panel-h">版本說明</h2>
              <p className="vd-notes">{diff.releaseNotes}</p>
            </section>
          ) : null}

          <section className="vd-panel">
            <h2 className="vd-panel-h">殘留副作用</h2>
            <div className="vd-notes">
              <ResidualNote diff={diff} />
            </div>
          </section>

          <section className="vd-panel">
            <h2 className="vd-panel-h">下一步</h2>
            <div className="vd-act">
              {diff.requiresReapproval ? (
                <label className="vd-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>我已閱讀上述變更，了解升級後行為與現在不同。</span>
                </label>
              ) : null}
              {canContinue ? (
                <Link className="btn btn-primary" to={installPath}>
                  檢視並下載升級腳本
                </Link>
              ) : (
                <button type="button" className="btn btn-primary" disabled>
                  檢視並下載升級腳本
                </button>
              )}
              <Link className="btn btn-ghost" to="/me/installations">
                返回我的安裝
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function VersionDiffPage(): ReactNode {
  const { packageId, version, targetVersion } = useParams<{
    packageId: string;
    version: string;
    targetVersion: string;
  }>();

  const fetcher = useCallback(
    (signal: AbortSignal) => {
      // 前置校驗必須拋 ApiError：usePageState 只保留 ApiError 的訊息，
      // 一般 Error 會被替換成通用文案，使用者就看不到可行動的指示。
      if (!packageId || !version || !targetVersion) {
        return Promise.reject(
          new ApiError({
            statusCode: 400,
            code: 'MISSING_DIFF_TARGET',
            message: '缺少比較版本；請從我的安裝或通知進入此頁。',
            retryable: false
          })
        );
      }
      return fetchVersionDiff(packageId, version, targetVersion, signal);
    },
    [packageId, targetVersion, version]
  );

  const { pageState, reload } = usePageState(fetcher, [
    packageId,
    version,
    targetVersion
  ]);

  return (
    <div className="vd">
      <header className="vd-head">
        <div>
          <h1>升級差異</h1>
          <p>
            比較你目前安裝的版本與目標版本；差異由每個「系統 × Client」的目前腳本指標精確導出。
          </p>
        </div>
      </header>
      <PageStateView pageState={pageState} onRetry={reload}>
        {(diff) => <DiffView diff={diff} />}
      </PageStateView>
    </div>
  );
}

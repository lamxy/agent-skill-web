// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { fetchPackageDetail } from '../api/catalog.js';
import type {
  PackageDetail,
  PackageVersionSummary
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { PageStateView } from '../components/PageStateView.js';
import { Button, Chip, LifecycleChip, SuccessRate } from '../components/primitives.js';
import { packageDownloads } from './catalog-taxonomy.js';
import { FeedbackSection } from './FeedbackSection.js';
import { SupportChannelsSection } from './SupportChannelsSection.js';
import './package-detail.css';

/**
 * 把版本聲明的 supportedOs 映射為腳本生成端點接受的 targetOs。
 *
 * declared 是版本層級的宣告值（linux、macos、windows、wsl），
 * targetOs 是 Task 13 收斂後的三值詞彙，兩者不同名因此需要對照表。
 * 修改時必須與 script-generator 的 body schema enum 保持一致，
 * 不一致會讓請求被擋在驗證層而非顯示為可理解的錯誤。
 */
export const OS_TARGETS: {
  label: string;
  declared: string[];
  targetOs: string;
}[] = [
  { label: 'Linux / macOS', declared: ['linux', 'macos'], targetOs: 'linux/macos' },
  { label: 'Windows', declared: ['windows'], targetOs: 'windows' },
  { label: 'WSL', declared: ['wsl'], targetOs: 'wsl' }
];

function scriptExtension(targetOs: string): string {
  return targetOs === 'windows' ? 'ps1' : 'sh';
}

function TargetPicker({
  version,
  action,
  onInspect
}: {
  version: PackageVersionSummary;
  action: 'install' | 'uninstall';
  onInspect: (targetOs: string, clientRuntime: string) => void;
}): ReactNode {
  const available = useMemo(
    () =>
      OS_TARGETS.filter((entry) =>
        entry.declared.some((os) => version.supportedOs.includes(os))
      ),
    [version.supportedOs]
  );

  const [osLabel, setOsLabel] = useState(available[0]?.label ?? '');
  const [client, setClient] = useState(
    version.supportedClients[0]?.name ?? ''
  );
  const selectedOs = available.find((entry) => entry.label === osLabel);
  const selectedClient = version.supportedClients.find(
    (entry) => entry.name === client
  );

  // 生成與錯誤處理移至安裝預覽頁；此處只負責帶著選定目標導向該頁。
  // 送出的是 clientRuntime 而非顯示名稱：API 只接受前者。
  const handleInspect = useCallback(() => {
    const clientRuntime = selectedClient?.clientRuntime;
    if (!selectedOs || !clientRuntime) return;
    onInspect(selectedOs.targetOs, clientRuntime);
  }, [onInspect, selectedClient, selectedOs]);

  if (available.length === 0 || version.supportedClients.length === 0) {
    return (
      <p className="pd-noscript">
        此版本尚未聲明可用的系統與 Client 組合，無法生成安裝腳本。
      </p>
    );
  }

  const fileName = selectedOs
    ? `${action}-*-${version.version}-${selectedOs.targetOs}-*.${scriptExtension(selectedOs.targetOs)}`
    : '';

  return (
    <>
      <div className="pd-picks">
        <fieldset className="pd-group">
          <legend className="pd-legend">作業系統</legend>
          {OS_TARGETS.map((entry) => {
            const enabled = available.some(
              (candidate) => candidate.label === entry.label
            );
            return (
              <label
                key={entry.label}
                className="pd-opt"
                data-on={enabled && entry.label === osLabel ? '' : undefined}
                data-off={enabled ? undefined : ''}
              >
                <input
                  type="radio"
                  name="targetOs"
                  value={entry.label}
                  checked={entry.label === osLabel}
                  disabled={!enabled}
                  onChange={() => setOsLabel(entry.label)}
                />
                <span>{entry.label}</span>
                {enabled ? null : (
                  <small>此版本未聲明支援</small>
                )}
              </label>
            );
          })}
        </fieldset>

        <fieldset className="pd-group">
          <legend className="pd-legend">Client</legend>
          {version.supportedClients.map((entry) => (
            <label
              key={entry.name}
              className="pd-opt"
              data-on={entry.name === client ? '' : undefined}
            >
              <input
                type="radio"
                name="clientRuntime"
                value={entry.name}
                checked={entry.name === client}
                onChange={() => setClient(entry.name)}
              />
              <span>{entry.name}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="pd-out">
        <div className="pd-out-row">
          <div className="pd-out-info">
            <div className="pd-fname mono">{fileName}</div>
            <p className="pd-fname-note">
              檔名含安裝目標與你的員工識別，用於回報這次安裝的結果。
              下一步先顯示完整腳本，確認後才下載。
            </p>
          </div>
          <Button
            variant="primary"
            disabled={!selectedOs || !selectedClient?.clientRuntime}
            onClick={handleInspect}
          >
            檢視並下載{action === 'uninstall' ? '卸載' : '安裝'}腳本
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * 下載 → 安裝 → 成功的漏斗。
 *
 * 安裝與成功次數是真實遙測；下載次數目前沒有埋點，暫以寫死值呈現版面，
 * 資料化範圍見任務 18。兩者可信度不同：下載發生在伺服器端可靠記錄，
 * 安裝回報則是盡力而為，離線或中斷時會遺失，因此註腳分別說明。
 */
function AdoptionFunnel({
  packageId,
  installations,
  succeeded,
  successRate
}: {
  packageId: string;
  installations: number;
  succeeded: number;
  successRate: number | null;
}): ReactNode {
  const downloads = packageDownloads(packageId);
  const stages = [
    { key: 'downloads', label: '下載腳本', value: downloads, mock: true },
    { key: 'installs', label: '執行安裝', value: installations, mock: false },
    { key: 'succeeded', label: '安裝成功', value: succeeded, mock: false }
  ];
  // 以最大值為基準，讓每段寬度直接反映流失幅度。全零時退回滿寬空條。
  const peak = Math.max(...stages.map((stage) => stage.value), 1);

  return (
    <>
      <ol className="pd-funnel">
        {stages.map((stage, index) => {
          const previous = stages[index - 1];
          const rate =
            previous && previous.value > 0
              ? Math.round((stage.value / previous.value) * 100)
              : null;
          return (
            <li key={stage.key}>
              {rate === null ? null : (
                <span className="pd-funnel-rate tabular">↓ {rate}%</span>
              )}
              <div className="pd-funnel-row">
                <span className="pd-funnel-label">
                  {stage.label}
                  {stage.mock ? <em>未埋點</em> : null}
                </span>
                <span className="pd-funnel-value tabular">
                  {stage.value.toLocaleString('zh-TW')}
                </span>
              </div>
              <div className="pd-funnel-track">
                <span
                  className="pd-funnel-bar"
                  data-mock={stage.mock ? '' : undefined}
                  style={{ width: `${(stage.value / peak) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <dl className="pd-stats pd-stats-tight">
        <div>
          <dt>安裝成功率</dt>
          <dd>
            <SuccessRate value={successRate} />
          </dd>
        </div>
      </dl>
      <p className="pd-stats-note">
        下載次數尚未實作記錄，此處為示意值。安裝與成功次數來自腳本回報，
        機制為盡力而為，離線時可能延後或遺失。
      </p>
    </>
  );
}

/** 三段式說明。上部與尾部由平台生成，此處只描述職責，不展示內容 */
function ScriptComposition(): ReactNode {
  return (
    <div className="pd-tri">
      <div className="pd-tri-row">
        <span className="pd-tri-tag">上部</span>
        <div>
          <div className="pd-tri-t">初始化與身分識別</div>
          <p className="pd-tri-d">
            取得你的員工識別；未登入時在本機產生並保存 UUID，同一台機器沿用同一組。
            同時建立冪等鍵與環境資訊。
          </p>
          <p className="pd-tri-lock">平台生成，腳本內不可見</p>
        </div>
      </div>
      <div className="pd-tri-row pd-tri-mid">
        <span className="pd-tri-tag">中部</span>
        <div>
          <div className="pd-tri-t">發布者的安裝命令</div>
          <p className="pd-tri-d">
            由發布者維護，在隔離的子命令下執行。平台不改寫這段內容。
          </p>
        </div>
      </div>
      <div className="pd-tri-row">
        <span className="pd-tri-tag">尾部</span>
        <div>
          <div className="pd-tri-t">結果識別與回報</div>
          <p className="pd-tri-d">
            記錄時間、系統環境與成功或失敗；失敗時收集錯誤碼，再把結果回報給平台。
            離線時排入本機佇列，下次執行補交。
          </p>
          <p className="pd-tri-lock">平台生成，腳本內不可見</p>
        </div>
      </div>
    </div>
  );
}

function DetailBody({ data }: { data: PackageDetail }): ReactNode {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const action = searchParams.get('intent') === 'uninstall' ? 'uninstall' : 'install';
  const published = data.versions.filter(
    (version) => version.lifecycle === 'published'
  );
  const current = published[0] ?? data.versions[0];

  /*
   * 不直接下載。員工執行的腳本會改動自己的機器，必須先在安裝預覽頁
   * 看到完整內容再決定，見 docs/前端實作指導.md 的安裝頁章節。
   */
  const handleInspect = useCallback(
    (targetOs: string, clientRuntime: string) => {
      if (!current) return;
      const query = new URLSearchParams({ os: targetOs, client: clientRuntime, action });
      void navigate(
        `/packages/${encodeURIComponent(data.packageId)}/versions/${encodeURIComponent(current.version)}/install?${query.toString()}`
      );
    },
    [action, current, data.packageId, navigate]
  );

  return (
    <div className="pd">
      <Breadcrumb items={[{ label: '技能池', to: '/' }, { label: data.name }]} />
      <header className="pd-head">
        <h1 className="pd-h1">{data.name}</h1>
        <p className="pd-meta">
          {data.ownerTeam} · {data.type === 'skill' ? 'Skill' : 'Tool'} ·{' '}
          {data.category} · {data.license}
          {current ? (
            <>
              {' · '}
              <LifecycleChip lifecycle={current.lifecycle} />
              {' · 版本 '}
              <span className="mono">{current.version}</span>
            </>
          ) : null}
        </p>
        <p className="pd-purpose">{data.purpose}</p>
      </header>

      <section className="pd-panel">
        <div className="pd-panel-h">
          <h2 className="pd-panel-t">取得一鍵{action === 'uninstall' ? '卸載' : '安裝'}腳本</h2>
          <p className="pd-panel-s">
            {action === 'uninstall' ? '我的安裝不保存目標環境，請重新選擇實際 OS 與 Client。' : '選擇你的環境。平台為每個組合生成專屬腳本，未聲明支援的組合不提供下載。'}
          </p>
        </div>
        {current && current.lifecycle === 'published' ? (
          <TargetPicker version={current} action={action} onInspect={handleInspect} />
        ) : (
          <p className="pd-noscript">
            此版本尚未發布，不提供下載。審核通過後才會開放。
          </p>
        )}
      </section>

      <div className="pd-cards">
        <section className="pd-card">
          <h2 className="pd-card-h">安裝前請注意</h2>
          <ul className="pd-list">
            {current?.hasResidualEffects ? (
              <li>
                <span className="pd-dot pd-dot-warn" />
                <div>
                  <b>解除安裝後會留下內容</b>
                  <p>
                    {current.residualDescription ?? '發布者未提供殘留說明。'}
                    {current.manualCleanupSteps
                      ? ` 完全移除請執行：${current.manualCleanupSteps}`
                      : ''}
                  </p>
                </div>
              </li>
            ) : (
              <li>
                <span className="pd-dot pd-dot-ok" />
                <div>
                  <b>解除安裝後不留殘留</b>
                  <p>發布者聲明解除安裝會清除所有寫入內容。</p>
                </div>
              </li>
            )}
            <li>
              <span className="pd-dot pd-dot-ok" />
              <div>
                <b>會回報安裝結果</b>
                <p>
                  腳本執行後回報安裝時間、系統環境與成功或失敗，用於改善安裝成功率。
                  不收集命令輸出與檔案內容。
                </p>
              </div>
            </li>
          </ul>
        </section>

        <section className="pd-card">
          <h2 className="pd-card-h">採用數據</h2>
          <AdoptionFunnel
            packageId={data.packageId}
            installations={data.adoption.installations}
            succeeded={data.adoption.succeeded}
            successRate={data.adoption.successRate}
          />
        </section>
      </div>

      <section className="pd-card">
        <h2 className="pd-card-h">支援範圍</h2>
        {current ? (
          <dl className="pd-kv">
            <dt>作業系統</dt>
            <dd className="mono">{current.supportedOs.join(' · ')}</dd>
            <dt>Client</dt>
            <dd>
              {current.supportedClients.map((entry) => entry.name).join('、')}
            </dd>
            <dt>適配來源</dt>
            <dd>
              {current.supportedClients[0]?.adaptationSource === 'publisher'
                ? '發布者維護'
                : current.supportedClients[0]?.adaptationSource === 'maintainer'
                  ? '維護者適配'
                  : '社群貢獻'}
            </dd>
          </dl>
        ) : (
          <p className="pd-noscript">尚無可用版本。</p>
        )}
      </section>

      <section className="pd-card">
        <h2 className="pd-card-h">其他版本</h2>
        <ul className="pd-vers">
          {data.versions.map((version) => (
            <li key={version.id}>
              <span className="mono">{version.version}</span>
              <LifecycleChip lifecycle={version.lifecycle} />
            </li>
          ))}
        </ul>
      </section>

      <SupportChannelsSection packageId={data.packageId} />

      <section className="pd-card">
        <h2 className="pd-card-h">腳本的組成</h2>
        <ScriptComposition />
      </section>

      {/*
        回報使用問題與點讚評論屬於「看完技能資訊之後才會做的事」，
        固定排在頁面最底部，不與上方的技能說明區塊爭奪注意力。
      */}
      {current ? (
        <FeedbackSection packageId={data.packageId} version={current.version} />
      ) : null}

      {/*
        以下是 P2-1 的點讚與評論佔位，與上方的結構化使用反饋是不同功能：
        結構化反饋已於第一期實作，點讚評論仍屬第二期。兩者不共用區塊。
      */}
      <section className="pd-card pd-soon">
        <h2 className="pd-card-h">
          點讚與評論
          <span className="pd-soon-tag">第二期功能，尚未實作</span>
        </h2>
        <div className="pd-fb">
          <span className="pd-fb-btn">
            有幫助 <span className="pd-fb-cnt">—</span>
          </span>
          <span className="pd-fb-btn">
            沒幫助 <span className="pd-fb-cnt">—</span>
          </span>
        </div>
        <p className="pd-fb-empty">
          評論功能尚未實作。此區塊保留版面位置，第二期開放後在此顯示評論列表。
        </p>
      </section>
    </div>
  );
}

export function PackageDetailPage(): ReactNode {
  const { packageId } = useParams<{ packageId: string }>();

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchPackageDetail(packageId ?? '', signal),
    [packageId]
  );

  const { pageState, reload } = usePageState(fetcher, [packageId]);

  return (
    <PageStateView pageState={pageState} onRetry={reload}>
      {(data) => <DetailBody data={data} />}
    </PageStateView>
  );
}

// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import {
  buildAnalyticsPath,
  fetchPackageAnalytics
} from '../api/analytics.js';
import { ApiError } from '../api/client.js';
import type {
  PackageAnalyticsReport,
  SuccessRateMetrics
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import {
  buildFailureMatrix,
  formatAnalyticsRate,
  formatDateInputValue
} from './analytics-model.js';
import './analytics.css';

const initialEnd = new Date();
const initialStart = new Date(initialEnd);
initialStart.setDate(initialStart.getDate() - 29);
const initialEndDate = formatDateInputValue(initialEnd);
const initialStartDate = formatDateInputValue(initialStart);

function FunnelChart({ report }: { report: PackageAnalyticsReport }): ReactNode {
  const { downloads, installs, uninstalls } = report.funnel;
  const segments = [
    { label: '下載', count: downloads, y: 16, tone: 'soft' },
    { label: '安裝', count: installs, y: 72, tone: 'accent' },
    { label: '解除安裝', count: uninstalls, y: 128, tone: 'seal' }
  ];
  const maximum = Math.max(downloads, installs, uninstalls, 1);

  return (
    <svg
      className="an-funnel"
      viewBox="0 0 560 184"
      role="img"
      aria-label={`下載 ${downloads} 次、安裝 ${installs} 次、解除安裝 ${uninstalls} 次`}
    >
      {segments.map((segment, index) => {
        const upperWidth = 500 * Math.max(segment.count / maximum, 0.2);
        const lowerCount = segments[index + 1]?.count ?? segment.count * 0.72;
        const lowerWidth = 500 * Math.max(lowerCount / maximum, 0.16);
        const upperLeft = (560 - upperWidth) / 2;
        const lowerLeft = (560 - lowerWidth) / 2;
        return (
          <g key={segment.label}>
            <polygon
              className={`an-funnel-${segment.tone}`}
              points={`${upperLeft},${segment.y} ${upperLeft + upperWidth},${segment.y} ${lowerLeft + lowerWidth},${segment.y + 44} ${lowerLeft},${segment.y + 44}`}
            />
            <text x="280" y={segment.y + 27} textAnchor="middle">
              {segment.label} {segment.count}
              {index === 1 && report.funnel.downloadToInstall !== null
                ? ` · ${formatAnalyticsRate(report.funnel.downloadToInstall)}`
                : index === 2 && report.funnel.installToUninstall !== null
                  ? ` · ${formatAnalyticsRate(report.funnel.installToUninstall)}`
                  : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RateRow({ label, metrics }: { label: string; metrics: SuccessRateMetrics }): ReactNode {
  const rate = metrics.rate;
  const interval = metrics.confidenceInterval;
  return (
    <div className="an-rate-row">
      <span className="an-rate-name mono">{label}</span>
      <div className="an-rate-track" aria-hidden="true">
        <span
          className="an-rate-fill"
          style={{ width: `${(rate ?? 0) * 100}%` }}
        />
        {interval ? (
          <span
            className="an-rate-ci"
            style={{
              left: `${interval.lower * 100}%`,
              width: `${(interval.upper - interval.lower) * 100}%`
            }}
          />
        ) : null}
      </div>
      <strong className="tabular">{formatAnalyticsRate(rate)}</strong>
      <small>
        {metrics.successes} / {metrics.total} 成功
        {interval
          ? ` · Wilson 95%：${formatAnalyticsRate(interval.lower)}–${formatAnalyticsRate(interval.upper)}`
          : ''}
      </small>
    </div>
  );
}

function FailureHeatmap({ report }: { report: PackageAnalyticsReport }): ReactNode {
  const [osFilter, setOsFilter] = useState('all');
  const matrix = useMemo(
    () => buildFailureMatrix(report.failureCells),
    [report.failureCells]
  );
  const operatingSystems = useMemo(
    () => [...new Set(matrix.rows.map((row) => row.osType))],
    [matrix.rows]
  );
  const rows =
    osFilter === 'all'
      ? matrix.rows
      : matrix.rows.filter((row) => row.osType === osFilter);

  return (
    <section className="an-card an-wide">
      <header className="an-card-head">
        <div>
          <h2>失敗熱力圖</h2>
          <p>版本 × 作業系統 × 錯誤碼</p>
        </div>
        {operatingSystems.length > 0 ? (
          <div className="an-filters" role="group" aria-label="依作業系統篩選">
            <button
              type="button"
              aria-pressed={osFilter === 'all'}
              data-active={osFilter === 'all' ? '' : undefined}
              onClick={() => setOsFilter('all')}
            >
              全部
            </button>
            {operatingSystems.map((os) => (
              <button
                key={os}
                type="button"
                aria-pressed={osFilter === os}
                data-active={osFilter === os ? '' : undefined}
                onClick={() => setOsFilter(os)}
              >
                {os}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div className="an-card-body">
        {matrix.rows.length === 0 ? (
          <p className="an-empty">分析期間沒有失敗事件。</p>
        ) : (
          <div className="scroll-x">
            <table className="an-heatmap">
              <thead>
                <tr>
                  <th>版本 × OS</th>
                  {matrix.errorCodes.map((code) => (
                    <th key={code} className="mono">{code}</th>
                  ))}
                  <th>合計</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th className="mono">{row.version} · {row.osType}</th>
                    {row.counts.map((count, index) => (
                      <td key={matrix.errorCodes[index]} data-hot={count > 0 ? '' : undefined}>
                        {count}
                      </td>
                    ))}
                    <td data-total="">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function VersionDistribution({ report }: { report: PackageAnalyticsReport }): ReactNode {
  const total = report.versionDistribution.reduce(
    (sum, item) => sum + item.installations,
    0
  );
  const circumference = 2 * Math.PI * 38;
  let consumed = 0;

  return (
    <section className="an-card">
      <header className="an-card-head"><h2>版本分布</h2><span>目前安裝</span></header>
      <div className="an-card-body">
        {total === 0 ? (
          <p className="an-empty">目前沒有活躍安裝。</p>
        ) : (
          <div className="an-version-chart">
            <svg viewBox="0 0 100 100" role="img" aria-label={`目前共有 ${total} 次安裝`}>
              <circle className="an-donut-base" cx="50" cy="50" r="38" />
              {report.versionDistribution.map((item, index) => {
                const length = (item.installations / total) * circumference;
                const offset = -consumed;
                consumed += length;
                return (
                  <circle
                    key={item.version}
                    className={`an-donut-segment an-donut-${index % 4}`}
                    cx="50"
                    cy="50"
                    r="38"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={offset}
                  />
                );
              })}
              <text x="50" y="54" textAnchor="middle">{total}</text>
            </svg>
            <ul>
              {report.versionDistribution.map((item) => (
                <li key={item.version}><span className="mono">{item.version}</span><b>{item.installations}</b></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function AnalyticsBody({ report }: { report: PackageAnalyticsReport }): ReactNode {
  const { funnel, timeToRunnable } = report;
  return (
    <>
      {report.dataGaps.map((gap) => (
        <aside className="an-gap" key={gap.code} role="status">
          <span className="mono">{gap.code}</span>
          <div><strong>資料存在缺口</strong><p>{gap.message}。員工時間為近似值，請勿視為完整採用人數或精確耗時。</p></div>
        </aside>
      ))}

      <div className="an-metrics">
        <article><span>下載</span><strong>{funnel.downloads}</strong><small>分析期間事件</small></article>
        <article><span>安裝</span><strong>{funnel.installs}</strong><small>{funnel.downloadToInstall === null ? '尚無轉換率' : `下載轉安裝 ${formatAnalyticsRate(funnel.downloadToInstall)}`}</small></article>
        <article><span>解除安裝</span><strong>{funnel.uninstalls}</strong><small>{funnel.installToUninstall === null ? '尚無解除率' : `安裝後解除 ${formatAnalyticsRate(funnel.installToUninstall)}`}</small></article>
        <article><span>待升級 UID</span><strong>{report.upgradeCandidates.length}</strong><small>依 OS／Client 相容性篩選</small></article>
      </div>

      <div className="an-layout">
        <div className="an-main-column">
          <section className="an-card">
            <header className="an-card-head"><h2>採用漏斗</h2><span>downloads → installs → uninstalls</span></header>
            <div className="an-card-body"><FunnelChart report={report} /></div>
          </section>
          <FailureHeatmap report={report} />
          <section className="an-card">
            <header className="an-card-head"><h2>待升級使用者</h2><span>僅顯示具名 UID</span></header>
            {report.upgradeCandidates.length === 0 ? (
              <div className="an-card-body"><p className="an-empty">目前沒有相容且可升級的使用者。</p></div>
            ) : (
              <div className="scroll-x"><table className="an-table"><thead><tr><th>員工 UID</th><th>目前版本</th><th>可用版本</th></tr></thead><tbody>{report.upgradeCandidates.map((candidate) => <tr key={candidate.uid}><td className="mono">{candidate.uid}</td><td className="mono">{candidate.currentVersion}</td><td><span className="mono">{candidate.currentVersion}</span><span className="an-arrow">→</span><strong className="mono">{candidate.availableVersion}</strong></td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>

        <aside className="an-side-column">
          <section className="an-card">
            <header className="an-card-head"><h2>成功率</h2><span>UID 與 UUID 分開</span></header>
            <div className="an-card-body"><RateRow label="uid" metrics={report.successRates.uid} /><RateRow label="uuid" metrics={report.successRates.uuid} /><p className="an-legend"><i />成功率 <b />Wilson 95% 信賴區間</p></div>
          </section>
          <section className="an-card">
            <header className="an-card-head"><h2>可執行時間</h2><span>樣本 {timeToRunnable.platform.sampleSize}</span></header>
            <div className="an-card-body an-times">
              <span>平台時間</span><strong>{timeToRunnable.platform.medianMilliseconds === null ? '尚無數據' : `${Math.round(timeToRunnable.platform.medianMilliseconds / 1000)} 秒`}</strong><small>P90 {timeToRunnable.platform.p90Milliseconds === null ? '—' : `${Math.round(timeToRunnable.platform.p90Milliseconds / 1000)} 秒`} · P95 {timeToRunnable.platform.p95Milliseconds === null ? '—' : `${Math.round(timeToRunnable.platform.p95Milliseconds / 1000)} 秒`}</small>
              <span>員工時間 · 近似</span><strong>{timeToRunnable.employee.medianMilliseconds === null ? '尚無數據' : `${Math.round(timeToRunnable.employee.medianMilliseconds / 1000)} 秒`}</strong><small>P90 {timeToRunnable.employee.p90Milliseconds === null ? '—' : `${Math.round(timeToRunnable.employee.p90Milliseconds / 1000)} 秒`} · P95 {timeToRunnable.employee.p95Milliseconds === null ? '—' : `${Math.round(timeToRunnable.employee.p95Milliseconds / 1000)} 秒`}</small>
            </div>
          </section>
          <VersionDistribution report={report} />
        </aside>
      </div>
    </>
  );
}

export function AnalyticsPage(): ReactNode {
  const { packageId } = useParams<{ packageId: string }>();
  const [startDraft, setStartDraft] = useState(initialStartDate);
  const [endDraft, setEndDraft] = useState(initialEndDate);
  const [period, setPeriod] = useState({ start: initialStartDate, end: initialEndDate });
  const [periodError, setPeriodError] = useState('');

  const fetcher = useCallback(
    (signal: AbortSignal) => {
      if (!packageId) {
        throw new ApiError({ statusCode: 400, code: 'PACKAGE_ID_REQUIRED', message: '缺少套件識別，請回技能池重選。', retryable: false });
      }
      return fetchPackageAnalytics(packageId, period.start, period.end, signal);
    },
    [packageId, period.end, period.start]
  );
  const { pageState, reload } = usePageState(fetcher, [packageId, period.start, period.end]);

  return (
    <div className="an-page">
      <div className="an-crumb"><Link to="/">技能池</Link> / <span className="mono">{packageId}</span> / 作者分析</div>
      <header className="an-page-head">
        <div><h1>作者分析</h1><p>先看採用是否正常，再定位失敗與可升級使用者。</p><span className="an-assurance">best-effort · 數據僅供參考</span></div>
        <form className="an-period" onSubmit={(event) => {
          event.preventDefault();
          try {
            buildAnalyticsPath(packageId ?? '', startDraft, endDraft);
            setPeriodError('');
            setPeriod({ start: startDraft, end: endDraft });
          } catch (error) {
            setPeriodError(error instanceof Error ? error.message : '分析期間無效');
          }
        }}>
          <label>開始日期<input type="date" value={startDraft} onChange={(event) => setStartDraft(event.target.value)} required /></label>
          <label>結束日期<input type="date" value={endDraft} onChange={(event) => setEndDraft(event.target.value)} required /></label>
          <button type="submit">套用期間</button>
          <output className="an-period-status" data-error={periodError ? '' : undefined} aria-live="polite">{periodError || `${period.start} 至 ${period.end}`}</output>
        </form>
      </header>
      <PageStateView pageState={pageState} onRetry={reload}>
        {(report) => <AnalyticsBody report={report} />}
      </PageStateView>
    </div>
  );
}

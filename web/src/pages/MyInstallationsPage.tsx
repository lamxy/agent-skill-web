// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { fetchMyInstallations } from '../api/installations.js';
import type { MyInstallation } from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { InstallIcon } from '../components/icons.js';
import { Chip } from '../components/primitives.js';
import {
  filterMyInstallations,
  installationTargetPath,
  type InstallationFilter
} from './admin-model.js';
import { versionDiffPath } from './experience-model.js';
import './my-installations.css';

function InstallationActions({ item }: { item: MyInstallation }): ReactNode {
  return (
    <div className="mi-actions">
      {item.upgradeAvailable ? (
        <Link className="btn btn-primary" to={versionDiffPath(item.packageId, item.currentVersion, item.availableVersion)}>檢視升級差異</Link>
      ) : null}
      <Link className="btn btn-ghost" to={installationTargetPath(item.packageId, 'uninstall')}>選擇目標並卸載</Link>
    </div>
  );
}

export function MyInstallationsPage(): ReactNode {
  const fetcher = useCallback((signal: AbortSignal) => fetchMyInstallations(signal), []);
  const { pageState, reload } = usePageState(fetcher, [], {
    isEmpty: (items) => items.length === 0,
    emptyMessage: '目前沒有已安裝套件；從技能池選擇套件後即可取得安裝腳本。'
  });
  const [filter, setFilter] = useState<InstallationFilter>('all');

  return (
    <div className="mi">
      <header className="mi-head"><div><h1><InstallIcon className="page-title-icon" />我的安裝</h1><p>依真實遙測終態整理目前版本；卸載前仍需重新選擇實際 OS 與 Client。</p></div></header>
      <div className="mi-filters" role="group" aria-label="安裝狀態篩選">
        {([['all', '全部'], ['upgrade', '可升級'], ['current', '最新版']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} data-active={filter === value ? '' : undefined} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <section className="mi-panel">
        <PageStateView pageState={pageState} onRetry={reload}>
          {(items) => <InstallationList items={items} filter={filter} />}
        </PageStateView>
      </section>
    </div>
  );
}

function InstallationList({ items, filter }: { items: MyInstallation[]; filter: InstallationFilter }): ReactNode {
  const filtered = useMemo(() => filterMyInstallations(items, filter), [filter, items]);
  if (filtered.length === 0) return <div className="mi-filter-empty"><strong>此篩選沒有套件</strong><p>切換到「全部」查看其他已安裝項目。</p></div>;
  return (
    <>
      <div className="mi-desktop"><table><thead><tr><th>套件</th><th>目前版本</th><th>可用版本</th><th>狀態</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.packageId}><td><strong>{item.packageName}</strong><small className="mono">{item.packageId}</small></td><td className="mono">{item.currentVersion}</td><td className="mono">{item.availableVersion}</td><td>{item.upgradeAvailable ? <Chip tone="warn">可升級</Chip> : <Chip tone="ok">最新版</Chip>}</td><td><InstallationActions item={item} /></td></tr>)}</tbody></table></div>
      <div className="mi-mobile">{filtered.map((item) => <article key={item.packageId}><div className="mi-mobile-head"><div><strong>{item.packageName}</strong><small className="mono">{item.packageId}</small></div>{item.upgradeAvailable ? <Chip tone="warn">可升級</Chip> : <Chip tone="ok">最新版</Chip>}</div><dl><dt>目前版本</dt><dd className="mono">{item.currentVersion}</dd><dt>可用版本</dt><dd className="mono">{item.availableVersion}</dd></dl><InstallationActions item={item} /></article>)}</div>
    </>
  );
}

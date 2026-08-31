// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { fetchMaintainedPackages } from '../api/publish.js';
import type {
  MaintainedPackage,
  MaintainedPackageResult,
  MaintainedScope
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { MaintainIcon, PublishIcon } from '../components/icons.js';
import { Button, Chip, LifecycleChip } from '../components/primitives.js';
import './maintained-packages.css';

/**
 * 一列的動作文案。已發布過的技能是「更新版本」，
 * 還沒發布過的是「繼續編輯」——後者尚未對員工可見，語意不同。
 */
function actionLabel(item: MaintainedPackage): string {
  if (item.versionCount === 0) return '建立第一個版本';
  return item.hasPublishedVersion ? '更新版本' : '繼續編輯';
}

function PackageRow({ item }: { item: MaintainedPackage }): ReactNode {
  const latest = item.latestVersion;
  return (
    <tr>
      <td>
        <Link className="mp-name" to={`/packages/${item.packageId}`}>
          {item.name}
        </Link>
        <p className="mp-sub mono">
          {item.packageId} · {item.ownerTeam}
        </p>
      </td>
      <td className="mono">{latest?.version ?? '—'}</td>
      <td>
        {latest ? (
          <LifecycleChip lifecycle={latest.lifecycle} />
        ) : (
          <Chip>尚無版本</Chip>
        )}
      </td>
      <td>{item.visibility}</td>
      <td className="mp-act">
        <Link
          className="mp-link"
          to={`/publish/${encodeURIComponent(item.packageId)}`}
        >
          {actionLabel(item)}
        </Link>
      </td>
    </tr>
  );
}

function HubBody({
  data,
  canGoBack,
  onPrev,
  onNext
}: {
  data: MaintainedPackageResult;
  canGoBack: boolean;
  onPrev: () => void;
  onNext: () => void;
}): ReactNode {
  return (
    <>
      <div className="scroll-x">
        <table className="mp-table">
          <thead>
            <tr>
              <th>技能套件</th>
              <th>最新版本</th>
              <th>狀態</th>
              <th>可見性</th>
              <th className="mp-act">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <PackageRow key={item.packageId} item={item} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mp-foot">
        <span className="tabular">
          本頁 {data.items.length} 個 · 共 {data.totalCount} 個技能
        </span>
        <div className="mp-pager">
          <Button disabled={!canGoBack} onClick={onPrev}>
            上一頁
          </Button>
          <Button disabled={!data.nextCursor} onClick={onNext}>
            下一頁
          </Button>
        </div>
      </div>
    </>
  );
}

const SCOPE_TABS: {
  scope: MaintainedScope;
  label: string;
  hint: string;
  empty: string;
}[] = [
  {
    scope: 'mine',
    label: '我的技能',
    hint: '你自己建立的技能。',
    empty: '你還沒有建立任何技能。點右上角發布一個新技能。'
  },
  {
    scope: 'team',
    label: '團隊技能',
    hint: '你所屬團隊的技能——技能是團隊資產，同團隊成員都能維護。',
    empty: '你的團隊還沒有任何技能。'
  },
  {
    scope: 'all',
    label: '所有技能',
    hint: '平台上的全部技能。你有全域維護權限才看得到這一頁。',
    empty: '平台上還沒有任何技能。'
  }
];

export function MaintainedPackagesPage(): ReactNode {
  const [scope, setScope] = useState<MaintainedScope>('mine');
  /*
   * 權限保存在狀態中而非只讀自當次結果：清單為空時 PageStateView
   * 只渲染空狀態訊息，tab 若跟著資料走就會消失，切到空清單的
   * 管理員將無法切回去。
   */
  const [canSeeAll, setCanSeeAll] = useState(false);

  /*
   * 游標堆疊。伺服器只回下一頁的游標，要能往回翻就得自己記住走過的位置。
   * 切換範圍等於換一份清單，此時必須清空，否則游標會指向舊清單的位置。
   */
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack.at(-1);

  const fetcher = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchMaintainedPackages(
        { scope, ...(currentCursor ? { cursor: currentCursor } : {}) },
        signal
      );
      setCanSeeAll(result.canIncludeAllTeams);
      /*
       * 伺服器對無權者會把 all 退回 team，讓選中的 tab 跟著校正。
       * 必須確認回傳值是已知範圍再套用：舊版伺服器沒有這個欄位，
       * 直接寫入會讓 scope 變成 undefined，兩個 tab 都不再是選中態。
       */
      if (
        result.scope &&
        result.scope !== scope &&
        SCOPE_TABS.some((tab) => tab.scope === result.scope)
      ) {
        setCursorStack([]);
        setScope(result.scope);
      }
      return result;
    },
    [currentCursor, scope]
  );

  const activeTab = SCOPE_TABS.find((tab) => tab.scope === scope) ?? SCOPE_TABS[0]!;

  const options = useMemo(
    () => ({
      isEmpty: (data: MaintainedPackageResult) =>
        data.items.length === 0 && !currentCursor,
      emptyMessage: activeTab.empty
    }),
    [activeTab, currentCursor]
  );

  const { pageState, reload } = usePageState(
    fetcher,
    [scope, currentCursor],
    options
  );

  const visibleTabs = SCOPE_TABS.filter(
    (tab) => tab.scope !== 'all' || canSeeAll
  );

  return (
    <div className="mp">
      <div className="mp-head">
        <div>
          <h1 className="mp-h1">
            <MaintainIcon className="page-title-icon" />
            技能維護
          </h1>
          <p className="mp-lede">
            這裡列出你有維護權限的技能，包含還沒有任何已發布版本的草稿。
            技能池只顯示已發布的技能，因此新建立的技能只能從這裡找到。
          </p>
        </div>
        <Link className="mp-create" to="/publish/new">
          <PublishIcon />
          發布技能
        </Link>
      </div>

      <div className="mp-tabs" role="tablist" aria-label="技能範圍">
        {visibleTabs.map((tab) => (
          <button
            key={tab.scope}
            type="button"
            role="tab"
            aria-selected={tab.scope === scope}
            className="mp-tab"
            onClick={() => {
              // 換範圍等於換一份清單，游標必須歸零
              setCursorStack([]);
              setScope(tab.scope);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="mp-scope-hint">{activeTab.hint}</p>

      <PageStateView pageState={pageState} onRetry={reload}>
        {(data) => (
          <HubBody
            data={data}
            canGoBack={cursorStack.length > 0}
            onPrev={() => setCursorStack((stack) => stack.slice(0, -1))}
            onNext={() =>
              data.nextCursor &&
              setCursorStack((stack) => [...stack, data.nextCursor!])
            }
          />
        )}
      </PageStateView>
    </div>
  );
}

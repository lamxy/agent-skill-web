// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { searchPackages } from '../api/catalog.js';
import type {
  PackageCategoryCode,
  PackageGrade,
  PackageSource,
  PackageSummary,
  PackageVersionSummary,
  SearchFilters
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { CatalogIcon, PublishIcon, SearchIcon } from '../components/icons.js';
import { Button, Chip, LifecycleChip } from '../components/primitives.js';
import {
  CATEGORY_LABEL,
  GRADE_LABEL,
  GRADE_TONE,
  SOURCE_LABEL,
  packageDownloads
} from './catalog-taxonomy.js';
import './catalog.css';

const SORT_LABEL: Record<NonNullable<SearchFilters['sort']>, string> = {
  name_asc: '名稱 A → Z',
  name_desc: '名稱 Z → A',
  updated_desc: '最近更新'
};

/**
 * 網址參數是使用者可任意編輯的輸入，列舉值必須逐一比對後才放行。
 * 直接轉型會讓後端收到不在 enum 內的值而回 400，整頁變成錯誤狀態，
 * 但使用者只是改了網址列，正確的行為是忽略那個無效條件。
 */
function readEnumParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const value = params.get(key);
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** 以網址參數保存篩選條件，讓搜尋結果可分享也能用瀏覽器返回 */
function readFilters(params: URLSearchParams): SearchFilters {
  const sort = params.get('sort');
  const categoryCode = readEnumParam(
    params,
    'categoryCode',
    Object.keys(CATEGORY_LABEL) as PackageCategoryCode[]
  );
  const grade = readEnumParam(
    params,
    'grade',
    Object.keys(GRADE_LABEL) as PackageGrade[]
  );
  const source = readEnumParam(
    params,
    'source',
    Object.keys(SOURCE_LABEL) as PackageSource[]
  );
  return {
    ...(params.get('keyword') ? { keyword: params.get('keyword') as string } : {}),
    ...(params.get('category')
      ? { category: params.get('category') as string }
      : {}),
    ...(categoryCode ? { categoryCode } : {}),
    ...(grade ? { grade } : {}),
    ...(source ? { source } : {}),
    ...(params.get('client') ? { client: params.get('client') as string } : {}),
    ...(params.get('os') ? { os: params.get('os') as string } : {}),
    ...(sort === 'name_asc' || sort === 'name_desc' || sort === 'updated_desc'
      ? { sort }
      : {})
  };
}

/**
 * 卸載殘留欄。有殘留時補一行小字，因為「有殘留」本身不足以讓人知道
 * 卸載後還得自己動手；發布者有填清理步驟就直接顯示，沒填也要說明需手動處理。
 */
function ResidualCell({ version }: { version: PackageVersionSummary }): ReactNode {
  if (!version.hasResidualEffects) {
    return <Chip>無殘留</Chip>;
  }
  return (
    <>
      <Chip tone="warn">有殘留</Chip>
      <p className="cat-residual-note">
        {version.manualCleanupSteps
          ? `卸載後可能需手動清理殘留檔案：${version.manualCleanupSteps}`
          : '卸載後可能需手動清理殘留檔案，詳見技能詳情頁。'}
      </p>
    </>
  );
}

function PackageRow({ item }: { item: PackageSummary }): ReactNode {
  const version = item.latestVersion;
  return (
    <tr>
      <td>
        <Link className="cat-name" to={`/packages/${item.packageId}`}>
          {item.name}
        </Link>
        <p className="cat-purpose">{item.purpose}</p>
        {/* 標籤帶：分級最先，因為它決定要不要繼續看下去 */}
        <div className="cat-tags">
          <Chip tone={GRADE_TONE[item.grade]}>{GRADE_LABEL[item.grade]}</Chip>
          <Chip>{CATEGORY_LABEL[item.categoryCode]}</Chip>
          <Chip>{SOURCE_LABEL[item.source]}</Chip>
        </div>
        {/*
          只顯示所屬團隊。發布者類型與名稱都由團隊推導而來，
          三者並列等於把同一件事說三遍。
        */}
        <p className="cat-owner">{item.ownerTeam}</p>
      </td>
      <td>
        <Chip>{item.type === 'skill' ? 'Skill' : 'Tool'}</Chip>
      </td>
      <td>
        <LifecycleChip lifecycle={version.lifecycle} />
        <div className="cat-ver mono">{version.version}</div>
      </td>
      <td>
        <div className="cat-os mono">{version.supportedOs.join(' · ')}</div>
        <div className="cat-clients">
          {version.supportedClients.map((client) => client.name).join('、')}
        </div>
      </td>
      <td className="cat-heat">
        {/* 下載尚未埋點（任務 18），安裝數只在詳情頁提供，列表不重複揭露 */}
        <div className="tabular">
          {packageDownloads(item.packageId).toLocaleString('zh-TW')}
        </div>
        <div className="cat-heat-sub">未埋點</div>
      </td>
      <td>
        <ResidualCell version={version} />
      </td>
      <td className="cat-act">
        <Link className="cat-link" to={`/packages/${item.packageId}`}>
          查看詳情
        </Link>
      </td>
    </tr>
  );
}

/**
 * H5 版列表。表格在窄屏只能靠橫向捲動才看得到狀態與殘留，
 * 而這兩項正是「能不能安裝」的判斷依據，因此行動端改為卡片直排，
 * 與「我的安裝」頁的 desktop/mobile 雙渲染慣例一致。
 */
function PackageCard({ item }: { item: PackageSummary }): ReactNode {
  const version = item.latestVersion;
  return (
    <article className="cat-card">
      <div className="cat-card-head">
        <Link className="cat-name" to={`/packages/${item.packageId}`}>
          {item.name}
        </Link>
        <LifecycleChip lifecycle={version.lifecycle} />
      </div>
      <p className="cat-purpose">{item.purpose}</p>
      <div className="cat-tags">
        <Chip tone={GRADE_TONE[item.grade]}>{GRADE_LABEL[item.grade]}</Chip>
        <Chip>{item.type === 'skill' ? 'Skill' : 'Tool'}</Chip>
        <Chip>{CATEGORY_LABEL[item.categoryCode]}</Chip>
        <Chip>{SOURCE_LABEL[item.source]}</Chip>
      </div>
      <dl className="cat-card-kv">
        <dt>版本</dt>
        <dd className="mono">{version.version}</dd>
        <dt>系統</dt>
        <dd className="mono">{version.supportedOs.join(' · ')}</dd>
        <dt>Client</dt>
        <dd>{version.supportedClients.map((client) => client.name).join('、')}</dd>
        <dt>下載數</dt>
        <dd className="tabular">
          {packageDownloads(item.packageId).toLocaleString('zh-TW')}
          <span className="cat-heat-sub">未埋點</span>
        </dd>
        <dt>卸載殘留</dt>
        <dd>
          <ResidualCell version={version} />
        </dd>
      </dl>
      <p className="cat-owner">{item.ownerTeam}</p>
      <Link className="cat-link" to={`/packages/${item.packageId}`}>
        查看詳情
      </Link>
    </article>
  );
}

export function CatalogPage(): ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  // 輸入框維持本地狀態，送出時才寫入網址，避免每次按鍵都發請求
  const [keywordDraft, setKeywordDraft] = useState(filters.keyword ?? '');

  /*
   * 游標堆疊。後端只回下一頁的游標，要能往回翻就得自己記住走過的位置。
   * 不放進網址：游標是結果集內的位置而非可分享的條件，篩選一改就失效。
   */
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack.at(-1);

  const query = useMemo(
    () => ({ ...filters, ...(currentCursor ? { cursor: currentCursor } : {}) }),
    [currentCursor, filters]
  );

  const fetcher = useCallback(
    (signal: AbortSignal) => searchPackages(query, signal),
    [query]
  );

  const { pageState, reload } = usePageState(fetcher, [query], {
    isEmpty: (data) => data.items.length === 0 && !currentCursor,
    emptyMessage: filters.keyword
      ? '沒有符合條件的已發布套件。調整關鍵字或篩選條件再試一次。'
      : '目前沒有已發布的技能。你可以發布第一個技能。'
  });

  const updateParams = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      // 篩選條件變更後回到第一頁，否則游標會指向舊結果集的位置。
      setCursorStack([]);
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  return (
    <div className="cat">
      <div className="cat-head">
        <div>
          <h1 className="cat-h1">
            <CatalogIcon className="page-title-icon" />
            技能池
          </h1>
          <p className="cat-sub">先確認能否安全運行，再看採用熱度。</p>
        </div>
        <Link className="cat-publish" to="/publish/new">
          <PublishIcon />
          發布技能
        </Link>
      </div>

      <form
        className="cat-filters"
        onSubmit={(event) => {
          event.preventDefault();
          updateParams({ keyword: keywordDraft });
        }}
      >
        <input
          type="search"
          value={keywordDraft}
          onChange={(event) => setKeywordDraft(event.target.value)}
          placeholder="搜尋名稱、用途或所有團隊"
          aria-label="搜尋套件"
        />
        <Select
          value={filters.os ?? ''}
          onChange={(value) => updateParams({ os: value })}
          ariaLabel="作業系統"
          options={[
            { value: '', label: '全部系統' },
            { value: 'linux', label: 'linux' },
            { value: 'macos', label: 'macos' },
            { value: 'windows', label: 'windows' },
            { value: 'wsl', label: 'wsl' }
          ]}
        />
        <Select
          value={filters.grade ?? ''}
          onChange={(value) => updateParams({ grade: value })}
          ariaLabel="技能分級"
          options={[
            { value: '', label: '全部分級' },
            ...Object.entries(GRADE_LABEL).map(([value, label]) => ({ value, label }))
          ]}
        />
        <Select
          value={filters.categoryCode ?? ''}
          onChange={(value) => updateParams({ categoryCode: value })}
          ariaLabel="技能分類"
          options={[
            { value: '', label: '全部分類' },
            ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))
          ]}
        />
        <Select
          value={filters.source ?? ''}
          onChange={(value) => updateParams({ source: value })}
          ariaLabel="技能來源"
          options={[
            { value: '', label: '全部來源' },
            ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))
          ]}
        />
        <Select
          value={filters.sort ?? 'name_asc'}
          onChange={(value) => updateParams({ sort: value })}
          ariaLabel="排序方式"
          options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <button type="submit" className="cat-search-btn">
          <SearchIcon className="cat-search-icon" />
          搜尋
        </button>
      </form>

      <PageStateView pageState={pageState} onRetry={reload}>
        {(data) => (
          <>
            <div className="scroll-x cat-desktop">
              <table className="cat-table">
                <thead>
                  <tr>
                    <th>技能套件</th>
                    <th>類型</th>
                    <th>狀態</th>
                    <th>支援範圍</th>
                    <th>下載數</th>
                    <th>卸載殘留</th>
                    <th className="cat-act">詳情</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <PackageRow key={item.packageId} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cat-mobile">
              {data.items.map((item) => (
                <PackageCard key={item.packageId} item={item} />
              ))}
            </div>
            <div className="cat-foot">
              <span className="tabular">本頁 {data.items.length} 筆</span>
              <div className="cat-pager">
                <Button
                  disabled={cursorStack.length === 0}
                  onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
                >
                  上一頁
                </Button>
                <Button
                  disabled={!data.nextCursor}
                  onClick={() =>
                    data.nextCursor &&
                    setCursorStack((stack) => [...stack, data.nextCursor!])
                  }
                >
                  下一頁
                </Button>
              </div>
            </div>
          </>
        )}
      </PageStateView>
    </div>
  );
}

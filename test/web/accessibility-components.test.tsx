// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { App, ShellFooter } from '../../web/src/App.js';
import { FooterActionProvider } from '../../web/src/api/footer-action-context.js';
import type { PageState } from '../../web/src/api/types.js';
import { PageStateView } from '../../web/src/components/PageStateView.js';
import { Button } from '../../web/src/components/primitives.js';
import { AuditLogsPage } from '../../web/src/pages/AuditLogsPage.js';
import { PublishForm } from '../../web/src/pages/PublishPage.js';

const tokenCss = readFileSync(
  new URL('../../web/src/styles/tokens.css', import.meta.url),
  'utf8'
);

function tokensFrom(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = tokenCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!block) throw new Error(`找不到 token 區塊：${selector}`);
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]])
  );
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)?.map((value) => Number.parseInt(value, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`無效色碼：${hex}`);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function renderPageState<T>(pageState: PageState<T>): string {
  return renderToStaticMarkup(
    <PageStateView pageState={pageState} onRetry={() => undefined}>
      {(data) => <p>{String(data)}</p>}
    </PageStateView>
  );
}

describe('前端共用無障礙契約', () => {
  it('提供可略過重複導覽的主內容入口', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('aria-label="主要導覽"');
  });

  it('loading 狀態向輔助技術宣告內容忙碌中', () => {
    const html = renderPageState({ state: 'loading' });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
  });

  it('empty 狀態以非打斷式訊息宣告可採取的下一步', () => {
    const html = renderPageState({
      state: 'empty',
      message: '調整篩選條件後再試一次。'
    });

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('調整篩選條件後再試一次。');
  });

  it('partial 狀態以非打斷式訊息列出缺失區段', () => {
    const html = renderPageState({
      state: 'partial',
      data: '主內容',
      unavailableSections: ['採用統計']
    });

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('採用統計');
    expect(html).toContain('主內容');
  });

  it('淺色與深色的輔助文字均符合 WCAG AA 一般文字對比', () => {
    const light = tokensFrom(':root');
    const dark = tokensFrom(":root[data-theme='dark']");

    expect(contrast(light['ink-faint'], light.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark['ink-faint'], dark.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it('淺色語意標籤文字符合 WCAG AA 一般文字對比', () => {
    const light = tokensFrom(':root');

    expect(contrast(light.ok, light['ok-soft'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.seal, light['seal-soft'])).toBeGreaterThanOrEqual(4.5);
  });

  it('稽核篩選說明內部值的來源與精確比對影響', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AuditLogsPage />
      </MemoryRouter>
    );

    expect(html).toContain('稽核紀錄顯示的完整事件名稱');
    expect(html).toContain('身份目錄中的完整 UID');
    expect(html).toContain('依目標類型輸入完整邏輯 ID');
  });

  it('更新版本 Matrix 的欄位、錯誤與狀態具可辨識關聯', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PublishForm packageId="demo-skill" packageName="示範技能" />
      </MemoryRouter>
    );

    expect(html).toContain('for="pub-package"');
    expect(html).toContain('id="pub-package"');
    expect(html).toContain('for="pub-install-command"');
    expect(html).toContain('for="pub-usage"');
  });

  /*
   * 保存與送審的按鈕已移到全站頁腳，其 aria-live 狀態區與
   * aria-describedby 關聯改由 ShellFooter 渲染，因此在頁腳層驗證。
   */
  it('頁腳動作區保留狀態播報與送審條件的關聯', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <FooterActionProvider
          initialAction={{
            hint: (
              <span aria-live="polite" aria-atomic="true">
                <span id="pub-review-readiness">
                  至少加入一個腳本組合後才能送出審核。
                </span>
              </span>
            ),
            content: (
              <Button type="button" ariaDescribedBy="pub-review-readiness" disabled>
                送出審核
              </Button>
            )
          }}
        >
          <ShellFooter />
        </FooterActionProvider>
      </MemoryRouter>
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="pub-review-readiness"');
    expect(html).toContain('aria-describedby="pub-review-readiness"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>送出審核<\/button>/);
  });
});

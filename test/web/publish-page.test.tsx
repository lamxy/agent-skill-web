// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PublishForm } from '../../web/src/pages/PublishPage.js';
import { reviewReadiness } from '../../web/src/pages/publish-model.js';

/** 表單含返回維護清單的連結，需要 router context 才能渲染 */
function render(isFirstVersion = false): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(PublishForm, {
        packageId: 'demo-skill',
        packageName: '示範技能',
        isFirstVersion
      })
    )
  );
}

describe('Task 13 更新版本 Matrix', () => {
  it('依核准線框呈現完整 Matrix、編輯器與 server-backed 操作', () => {
    const html = render();

    expect(html).toContain('為每個要支援的「系統 × Client」組合');
    expect(html).toContain('name="packageId"');
    expect(html).toContain('Linux / macOS');
    expect(html).toContain('Windows');
    expect(html).toContain('WSL');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Codex');
    expect(html).toContain('加入組合');
    expect(html).toContain('複製命令');
    expect(html).toContain('版本紀錄');
    expect(html).toContain('name="installCommand"');
    expect(html).toContain('name="uninstallCommand"');
    expect(html).toContain('選項參數');
    expect(html).toContain('ASP_OPT_');
    expect(html).toContain('name="usageInstructions"');
    expect(html).toContain('--help');
    expect(html).toContain('script_version');
    expect(html).toContain('options');
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('目前一次只能建立一個系統與 Client 組合');
    expect(html).not.toContain('後端尚未支援每個目標分開保存');
  });

  it('未建立版本時 Matrix 操作有明確 gate', () => {
    const html = render();

    expect(html).toContain('先建立版本草稿後即可逐組保存');
  });

  /*
   * 送審按鈕已移到全站頁腳（見 footer-action-context），不再由本元件輸出。
   * 其 gate 條件出自 reviewReadiness 這個純函式，因此直接對它斷言，
   * 比在 SSR 字串裡撈按鈕更貼近真正要保障的行為。
   */
  it('沒有任何腳本組合時不可送審，並說明原因', () => {
    const readiness = reviewReadiness({});

    expect(readiness.canSubmit).toBe(false);
    expect(readiness.message).toContain('至少加入一個腳本組合後才能送出審核');
  });
});

describe('Task 16 技能由網址決定', () => {
  it('技能欄位唯讀並顯示名稱與識別碼', () => {
    // 換技能等於換一份草稿，應回清單重新進入而非在此切換下拉選單。
    const html = render();

    expect(html).toContain('示範技能（demo-skill）');
    expect(html).toMatch(/<input[^>]*readOnly[^>]*name="packageId"/i);
    expect(html).not.toContain('選擇真實套件');
  });

  it('提供返回維護清單的入口', () => {
    // 返回入口改以麵包屑呈現，層級為「我維護的技能／技能名／當前動作」。
    const html = render();

    expect(html).toContain('href="/publish"');
    expect(html).toContain('我維護的技能');
    expect(html).toContain('aria-label="麵包屑"');
  });

  it('標題採用發布與更新的用語，不再稱上架', () => {
    const html = render();

    expect(html).toContain('更新技能版本');
    expect(html).not.toContain('上架新版本');
  });

  /*
   * 建立技能後會被導向到這個頁面，此時技能一個版本都沒有。
   * 對這些人說「更新版本」會像是走錯了頁面，因此兩種情境用語不同。
   */
  it('尚無版本時改稱填寫第一個版本，並說明為何還看不到這個技能', () => {
    const html = render(true);

    expect(html).toContain('填寫第一個版本');
    expect(html).not.toContain('更新技能版本');
    expect(html).toContain('還要有一個通過審核的版本才會出現在技能池');
  });

  it('已有版本時維持更新用語，不出現第一個版本的說明', () => {
    const html = render(false);

    expect(html).toContain('更新技能版本');
    expect(html).not.toContain('填寫第一個版本');
    expect(html).not.toContain('還要有一個通過審核的版本才會出現在技能池');
  });
});

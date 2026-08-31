# Task 9.8 頁面狀態與無障礙驗收記錄

驗收日期：2026-08-28

## 交付範圍

- 統一 `PageStateView` 的 loading、empty、error、partial、success 呈現與 ARIA 宣告。
- 路由內容新增錯誤邊界，保留頂層導覽並提供不洩漏內部細節的重試介面。
- 新增跳至主要內容入口與主要導覽名稱；修正 Catalog、審核與管理表單的鍵盤焦點環。
- 我的安裝、作者分析 OS 篩選與版本治理選取按鈕新增 `aria-pressed`。
- 審核理由欄位以 `aria-invalid`／`aria-describedby` 關聯錯誤與提示。
- 校正淺色／深色輔助文字與淺色語意標籤 token，使一般文字對比達 WCAG AA 4.5:1。
- 完成 R-3 全站內部值審計；稽核精確查詢缺少候選 API 的後端缺口已登記。

## 驗收結果

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| TypeScript 型別 | 通過 | `npm run typecheck` |
| 生產建置 | 通過 | `npm run build`，Vite 轉換 75 個模組 |
| 前端定向測試 | 通過 | `npm test -- test/web`，4 個測試檔共 37 項 |
| 新增無障礙契約 | 通過 | 7 項，涵蓋導覽、頁面狀態、色彩對比與稽核欄位語義 |
| 技能池→詳情→安裝預覽 | 通過 | 真實 PostgreSQL、`dev-admin` session 與 Chrome headless；腳本全文可見 |
| 鍵盤焦點 | 通過 | 首次 Tab 顯示跳至主要內容；搜尋、審核與稽核欄位顯示 2px 實線焦點環 |
| 選取狀態 | 通過 | 我的安裝篩選切換後 `aria-pressed` 由「全部」移至「可升級」 |
| 桌面版面 | 通過 | 1280×800 與 1024×768 均無整頁橫向溢位 |
| 瀏覽器健康 | 通過 | 無 Vite overlay、console error、runtime exception、network failure 或 HTTP 4xx／5xx |
| Diff 格式 | 通過 | `git diff --check` |

## 範圍決策

- 第一階段依 `AGENTS.md` 以 PC 為主要驗收基準；未為手機版擴張 Task 9.8。既有手機樣式保留。
- Task Master 原始描述的 Lighthouse 分數與手機斷點是初始規劃，不是目前文件權威驗收條件。本次以可重跑的 WCAG 對比契約、SSR 語義測試與真實 Chrome 鍵盤／DOM／console 證據取代；未新增 Lighthouse 依賴。
- 稽核 `eventType`、`actorUid`、`targetId` 允許任意擴充事件與跨聚合邏輯 ID，前端不能安全硬編碼完整清單。本期補精確比對與值來源說明；候選 API 留作已登記後端缺口。

## 技能與來源決策

- Registry 一輪搜尋的最高候選只有約 479 次安裝，全部低於 1,000 次門檻且沒有官方來源，因此不安裝。
- 使用既有 Vercel `react-best-practices`、前端測試除錯流程、TDD 與完成前驗證流程。
- Browser plugin 不在環境；`browse` 尚未完成一次性建置，未在未確認下修改全域工具環境。實機驗收使用既有 Google Chrome 與 DevTools Protocol，不新增依賴。

Task Master 9.8 狀態更新為 `done` 後，第一期 Task 9 下一項為 9.9 上架頁 Matrix。

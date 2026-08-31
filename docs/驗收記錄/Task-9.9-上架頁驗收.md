# Task 9.9 上架頁驗收記錄

驗收日期：2026-08-28

## 交付範圍

- 新增 `/publish` 上架頁與頂層導覽入口。
- 套件使用 Catalog 真實候選，不要求發布者手填 `packageId`。
- 依目前後端契約交付單一「系統 × Client」降級 Matrix，明示一次只保存一組命令。
- 支援 Linux／Windows 與 Claude Code／Codex；選擇會同步更新 Matrix 列、腳本語言與編輯區標題。
- 安裝／解除安裝命令必填；殘留開關開啟時，同時要求殘留說明與手動清理步驟。
- 前端校驗通過後才呼叫建立版本 API；草稿建立成功後才開放送審。
- 尾部遙測清單只顯示目前核准的十一欄，並連到隱私聲明。

## 驗收結果

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| TypeScript 型別 | 通過 | `npm run typecheck` |
| 生產建置 | 通過 | `npm run build`，Vite 轉換 79 個模組 |
| 上架頁定向測試 | 通過 | `npm test -- test/web/publish-page-model.test.ts test/web/publish-page.test.tsx`，2 個測試檔共 6 項 |
| 殘留條件欄位 | 通過 | 開啟「解除安裝後會留下內容」後，殘留內容說明與手動清理步驟同時展開並標為必填 |
| OS／Client 聯動 | 通過 | 選擇 Windows／Codex 後，Matrix 列與編輯區同步顯示 Windows · Codex · PowerShell |
| 前端阻擋 | 通過 | 填妥套件、版本與兩段命令但缺殘留說明時，頁面顯示欄位錯誤；清空後的 network 紀錄為零，未建立 `99.9.9` 草稿 |
| 桌面版面 | 通過 | 1280×800 與 1024×768 均無整頁橫向溢位 |
| 瀏覽器健康 | 通過 | console 無錯誤；驗收操作與 viewport 紀錄保存在 `.gstack/browse-audit.jsonl` |
| Diff 格式 | 通過 | `git diff --check` |

## 實作決策

- D-3 尚未解決：`PackageVersionRecord` 與建立版本 API 仍只有單一 `installCommand`／`uninstallCommand`。本次只呈現和保存一列，因為純前端多列在重新載入後無法還原，會誤導發布者以為資料已保存。
- R-3 已重查：套件、OS 與 Client 都使用權威候選；維護權限仍由伺服器校驗，前端不自行推導。
- WSL、每目標獨立儲存、跨組合複製、腳本版本、軟刪除、選項參數、使用說明與新增遙測欄位沒有偽裝成已完成，全部移至高優先 Task 13。

## Task Master

- Task 9.9：`done`。
- Task 9：`done`，第一期前端頁面閉環完成。
- Task 13：`pending`、高優先；先補後端 per-target 儲存與 API，再還原已審核的完整 Matrix。

## 技能與來源決策

- Registry 搜尋一輪在 30 秒內沒有回傳候選，因此不安裝未知來源技能，`skills-lock.json` 不變。
- 沿用已審核的前端設計、測試驅動與瀏覽驗收流程；沒有新增依賴。

# Task 3：技能目錄模組驗收

## 完成範圍

- 套件 CRUD：穩定 `package_id`、類型、名稱、用途、所有團隊、分類、可見性、來源、授權與軟歸檔生命週期。
- 版本管理：版本說明、OS、Client 名稱／版本／適配來源／維護者、生命週期、digest、安裝與解除安裝命令、殘留副作用與作者。
- 搜尋：關鍵字、分類、Client、OS、1～100 筆分頁、名稱與更新時間排序；相同排序值以 `package_id` 決勝，避免翻頁漂移。
- 可見性：匿名只看 public；登入可看 internal；列表與下載只接受 published；待審版本只在詳情對作者或指定非同團隊審核人可見。
- 詳情：用途與所有者、相容矩陣、命令、殘留、下載與採用摘要；五態契約見 `docs/目錄頁狀態契約.md`。
- 資料一致性：套件與版本異動同交易寫 Audit 與 Outbox；零外鍵，版本保存套件邏輯 ID。

## API 驗收

完整流程測試已執行：管理員登入、建立及更新套件、建立待審版本、確認待審下載為 404、發佈版本、匿名組合篩選、取得下載命令、軟歸檔、確認列表變成 empty。匿名寫入為 401，超出分頁上限為 400。

## 自動驗證

```text
npm run typecheck  → 通過
npm run build      → 通過
npm test           → 14 個測試檔、52 個測試通過
npm run db:migrate → 資料庫 migration 已是最新狀態
npm run db:check   → 資料庫連線正常
```

真實 PostgreSQL 整合測試確認：版本以文字 `package_id` 保存；`package.created`、`version.created`、`version.published` 同步留下不可變審計與 outbox；`public` schema 外鍵數量為 0。

## 延後項目

- Task #9 根據狀態契約與歸檔資訊架構實作實際前端頁面。
- 第二期或數據量達壓測門檻後，把第一期 offset cursor 下推為 PostgreSQL keyset 查詢；HTTP 的 `cursor` 欄位保持相容。

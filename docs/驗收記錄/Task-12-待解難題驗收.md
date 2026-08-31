# Task #12 待解難題驗收記錄

驗收日期：2026-08-25

## 已驗證結論

- Linux 父層 EXIT trap 在中部 `exit`、動態取消子程序 trap 與唯讀變數改寫失敗後仍上報，原始退出碼不被遙測覆寫。
- PowerShell 使用 `try/catch/finally` 並保留原生命令退出碼；第一期無法從同權限機制保證不可偽造，公開契約降級為 `telemetryAssurance: best-effort`。
- 四組 Linux／Windows × Codex／Claude Code 真實 Runner 矩陣通過；macOS 維持 `not_supported`。
- OS adapter 與 Client adapter 可由 registry 注入；新增 runtime 不改變 passed 證據的 install、telemetry、uninstall、cleanup 契約。
- Linux／WSL UUID 位於 `~/.agent-platform/uuid`；Windows 位於 `%APPDATA%\agent-platform\uuid`。同一使用者沿用，不同使用者隔離，刪除後重新生成並視為新使用者。
- FIFO、dead-letter、同步中提示、Runner 環境銷毀與套件殘留檔案 diff 已有真實執行測試。

## 驗證結果

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| 全量測試 | 通過 | 25 個測試檔、192 項測試 |
| 跨平台定向測試 | 通過 | 3 個測試檔、40 項測試 |
| TypeScript 型別 | 通過 | `npm run typecheck` |
| 生產建置 | 通過 | `npm run build` |
| Migration | 通過 | `資料庫 migration 已是最新狀態` |
| 資料庫健康 | 通過 | `資料庫連線正常` |
| public schema 外鍵 | 通過 | Compose PostgreSQL 查詢結果 `0` |

初次 migration／健康命令未帶 `DATABASE_URL`，因此按預設連線 127.0.0.1:5432 並回 `ECONNREFUSED`；補上本專案实际 55432 連線字串後重跑成功。這是操作參數錯誤，不是資料庫或 migration 失敗。

## 文件覆蓋

- `維護者指南.md`：命令、殘留聲明與修訂。
- `審核者指南.md`：矩陣、證據限制與檔案 diff。
- `使用者指南.md`：安裝、UUID、queue 與問題回報。
- `API使用說明.md`：OpenAPI 入口與核心契約。
- `運維指南.md`：WSL／Docker／PostgreSQL、監控與故障排除。

## 階段提交

- `878d7a8`：固化跨平台腳本、UUID 與 adapter 驗證契約。
- `de0575f`：完成五份角色操作指南與 Task #12 驗收文件。

Task Master 狀態已更新為 `done`；`task-master next` 現在指向 Task #8「M6 分析頁模組實作」。任務狀態與本行最終結論以獨立提交保存。

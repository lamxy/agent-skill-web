# Task #7 遙測上報驗收記錄

驗收日期：2026-08-25

## 交付範圍

- 公開 `POST /api/telemetry/report`，不依賴 Cookie session；OpenAPI 已登記。
- 十一欄白名單、額外欄位只記名稱、UUID／UID／RFC 3339／狀態／錯誤碼與時間順序驗證。
- Memory 與 PostgreSQL first-write-wins：首次 201、相同內容 duplicate 200、不同內容 409；未知 package/version 404。
- `installations` 保存反範式 package/version/fingerprint 快照，migration 可回填 legacy 與孤兒資料並可重跑。
- Linux／PowerShell runtime UUID、FIFO pending queue、非重試型 4xx dead-letter、可重試錯誤保留與同步中提示。
- Validation runner 以執行前後新增 JSON 行驗證 runtime UUID，不再從腳本文字讀固定 key。

## 驗收結果

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| TypeScript 型別 | 通過 | `npm run typecheck` |
| 生產建置 | 通過 | `npm run build` |
| 全量測試 | 通過 | 25 個測試檔、188 項測試 |
| API 定向測試 | 通過 | 公開上報、duplicate、conflict、404、OpenAPI、脫敏警告 |
| PostgreSQL 定向測試 | 通過 | migration 回填／重跑、並發首寫、零外鍵 |
| 跨平台真執行 | 通過 | Docker Linux 與 PowerShell 7，2 個檔案共 35 項定向測試 |
| Migration 第一次 | 通過 | `資料庫 migration 已是最新狀態` |
| Migration 第二次 | 通過 | `資料庫 migration 已是最新狀態` |
| 資料庫健康 | 通過 | `資料庫連線正常` |
| public schema 外鍵 | 通過 | Docker 容器內 `pg_constraint` 查詢結果為 `0` |
| 禁用語法掃描 | 通過 | `drizzle`／`src/shared` 無 FK、references 或 cascade 匹配 |

WSL host 沒有安裝 `psql`，因此首次 host 查詢回 `127`；改用同一 Compose PostgreSQL 容器內的 `psql` 執行只讀系統目錄查詢並取得 `0`。這是客戶端工具缺失，不是資料庫驗收失敗。

## 關鍵語義

- 遙測事實本身不可變；第一期不為每筆事件再寫 Audit／Outbox，避免三倍寫放大。
- `legacy_package_version_id` 只供舊資料追溯；新查詢使用 `package_id` 或 `package_id + version`。
- queue 重試保留原 key，每次腳本新執行產生新 key；install／uninstall 各自有不同 UUID。
- 同步失敗不覆寫維護者命令退出碼，不保存命令輸出、環境變數或秘密。
- `408`、`425`、`429`、網路錯誤與 `5xx` 保留重試；其他永久 `4xx` 才進入 dead-letter。Linux 可回收死亡程序留下的 queue lock，PowerShell queue I/O 失敗也不阻止維護者命令。
- 第一期 Validation runner 提供功能性執行證據，不宣稱能抵抗惡意發布者在同一使用者權限下竄改 capture 或 queue。獨立權限的 capture service、隔離 VM 與簽章／attestation 屬第二期加固，不阻塞第一期功能閉環。
- OIDC、遙測簽名、裝置證明、per-package token、完整 anti-replay 與進階限流留到第二期。

## 技能與來源決策

- `find-skills` 搜尋一輪後沒有合格窄技能，未安裝低採用或錯誤領域候選。
- 沿用專案級 `supabase-postgres-best-practices` 的 upsert、索引、型別與交易部分；專案零外鍵規則優先。
- Agency Agents 只讀參考 Data Engineer 的冪等、late-arriving data 與資料契約原則，未下載或執行倉庫腳本。
- 文件收尾使用本機 `document-release` 覆蓋審計，沒有推送或建立 PR。

## 階段提交

- `2763f53`：建立遙測領域與記憶體去重。
- `28a607a`：修正公開輸入型別與 RFC 3339 邊界。
- `5d9eb2b`：持久化反範式遙測事實。
- `63d0a46`：接入遙測接收 API。
- `22cb99f`：實作跨平台遙測補交。
- `93a4650`：保留原生命令失敗語義並補強 queue 容錯。

Task Master 狀態已更新為 `done`；`task-master next` 現在指向 Task #12「§6 待解難題驗證與文檔」。任務狀態與本行最終驗收結論以獨立提交保存。

# Agent 技能交付控制面

**v0.0.1** — 本專案由 vibe coding 協調 AI 開發完成。

這是一個以模組化單體起步的 Agent 技能交付平台。首期聚焦可信技能目錄、發布審核、跨 OS／Client 安裝腳本生成、遙測與採用分析。

## 技術基座

- Node.js 24、TypeScript 7、Fastify 5
- PostgreSQL 17、Drizzle ORM、`pg` connection pool
- OpenAPI 3.0.3 與 Swagger UI
- Vitest 行為測試

## 本地啟動

```bash
npm install
docker compose up -d --wait
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform npm run db:migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform npm run dev
```

服務啟動後：

- 健康檢查：`GET http://127.0.0.1:3000/health`
- API 文件：`http://127.0.0.1:3000/docs`
- OpenAPI JSON：`http://127.0.0.1:3000/docs/json`

開發環境可使用固定本地身份完成第一期流程（`GET /api/auth/login?uid=dev-admin`）。production／staging 尚未接入第二期 OIDC provider 時，登入端點固定回傳 `503 AUTH_PROVIDER_UNAVAILABLE`，不會降級成開發登入。

## 驗證

```bash
npm run typecheck
npm test
npm run build
npm run db:check
```

## 核心 API

技能目錄支援套件 CRUD、版本流程、搜尋與下載：

```text
GET    /api/packages?keyword=&category=&client=&os=&cursor=&limit=&sort=
POST   /api/packages
GET    /api/packages/:packageId
PATCH  /api/packages/:packageId
DELETE /api/packages/:packageId
POST   /api/packages/:packageId/versions
PATCH  /api/packages/:packageId/versions/:version
GET    /api/packages/:packageId/versions/:version/download
```

寫入 API 需要平臺管理員，或符合套件所有團隊作用域的維護者。匿名訪客只能搜尋 public 套件；待審版本不會出現在搜尋或下載，只在詳情對作者及指定審核人展示。

已發佈版本可按聲明的 OS 與 Client 生成安裝或解除安裝腳本：

```text
POST /api/packages/:packageId/versions/:version/scripts
body: { "targetOs": "linux|windows", "clientRuntime": "codex|claude-code", "action": "install|uninstall" }
```

回應包含完整腳本、SHA-256 digest、執行前預覽與 `telemetryAssurance: "best-effort"`。遙測端點由服務端 `TELEMETRY_ENDPOINT` 注入，請求端不能改寫。

平臺管理員可查詢不可變審計日誌（`GET /api/audit/logs`），支援 `eventType`、`actorUid`、`targetType`、`targetId`、`from`、`to`、`cursor` 與 `limit`。

## 遙測上報與斷線補交

安裝腳本可在沒有 Cookie session 的環境呼叫公開端點 `POST /api/telemetry/report`。首次寫入回 `201 duplicate:false`；同 key、同內容回 `200 duplicate:true`；同 key、不同內容回 `409 IDEMPOTENCY_KEY_CONFLICT`。額外欄位只記錄欄位名稱，不保存值或完整 payload。

每次真實執行腳本才產生新冪等 key；同一 pending 項重試保持原 key。匿名身份另按使用者持久化：Linux／WSL 使用 `~/.agent-platform/uuid`，Windows 使用 `%APPDATA%\agent-platform\uuid`。Linux 與 PowerShell 啟動時依 FIFO 補交：2xx 移除、非重試型 4xx 移到 `dead_letter_reports.jsonl`，`408`／`425`／`429`、網路或 5xx 保留當前與後續行。同步失敗不改寫 install／uninstall 原退出碼。

## 採用分析

作者、套件 owner team 的維護者或平臺管理員可讀取指定套件的分析：

```text
GET /api/packages/:packageId/analytics?start=<RFC3339>&end=<RFC3339>
```

回應包含下載→成功安裝→解除安裝漏斗、分開的 UID／UUID 成功率與 Wilson 95% 信賴區間、版本／OS／錯誤碼失敗 cells、首次可運行時間、活躍版本分布與可升級 UID。遙測是 `best-effort`，所有報表固定顯示「數據僅供參考」。

登入使用者可透過 `GET /api/me/installations` 讀取自己的目前安裝；此端點只按 session 的 UID 查詢，匿名 UUID 不會出現在清單或升級候選中。完整欄位與資料口徑見 [`API 使用說明`](docs/API使用說明.md)。

## 發布審核與驗證能力

版本由治理模組唯一寫入生命週期：`draft → validating → review_required → published`，已發布版本可進入 `deprecated`、`delisted` 或終態 `emergency_disabled`。提交驗證與 retry 使用 expected-state／active-token CAS；作者與 owner team 成員迴避審核。工作台展示提交時的 package/version snapshot、命令全文、殘留聲明、digest、相容矩陣與 Runner 證據。

撤下後下載入口立即失效，按成功安裝記錄以 UID 去重發送通知；匿名 UUID 不產生通知。Linux 使用 Docker 真實驗證，Windows 首期能力標記為 `powershell-wsl`，macOS 明確回報 `not_supported`。

## 平台端三段式安裝腳本

這是給終端使用者的工具／技能腳本契約，與 Agent 技能的專案級安裝政策不同。腳本固定由三段組成：

- 頭部：初始化執行環境；取得已登入使用者的 login UID，未識別身份使用持久 UUID。
- 中部：由發布者／維護者透過 UI 填寫並保存 `install`／`uninstall` 命令，平台不硬編碼命令內容。
- 尾部：上報成功、失敗與原因；遙測失敗不覆寫中部命令的原始退出碼，必要時寫入本機待上報佇列。

首期矩陣為 Linux／Windows × Codex／Claude Code，新增 OS 或 runtime 必須經 adapter 擴展。

## 模組邊界

```text
src/modules/
├── identity/          身份與權限
├── catalog/           技能目錄
├── script-generator/  安裝腳本生成
├── governance/        發布與審核
├── telemetry/         遙測接收
├── analytics/         採用分析
└── audit/             不可變審計

src/shared/
├── config/            環境配置
├── database/          PostgreSQL、Drizzle Schema、DB 探針
├── errors/            結構化錯誤
└── modules/           Fastify 模組工廠
```

## 文件

架構決策見 [`架構說明`](docs/架構說明.md)，技能來源與採用原因見 [`技能與工具備查`](docs/技能與工具備查.md)。操作入口分為 [`維護者指南`](docs/維護者指南.md)、[`審核者指南`](docs/審核者指南.md)、[`使用者指南`](docs/使用者指南.md)、[`API 使用說明`](docs/API使用說明.md) 與 [`運維指南`](docs/運維指南.md)。

原始碼檔案頂部的授權標頭由 `npm run license:headers` 產生（`npm run license:check` 只檢查不改動）。

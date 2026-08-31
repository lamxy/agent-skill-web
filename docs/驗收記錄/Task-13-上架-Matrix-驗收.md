# Task 13 上架 Matrix 驗收

驗收日期：2026-08-29
分支：`task-6-governance`
相關提交：`e5106c5` 儲存契約、`c83421d` 治理與腳本生成、`7dc3975` 前端 Matrix

## 驗收範圍

每個「系統 × Client」腳本目標可獨立儲存命令、選項、使用說明與殘留聲明；支援跨組合複製、腳本版本歷程、軟刪除與重建；送審閘門改由 active target 導出矩陣；遙測新增 `script_version` 與 `options` 兩欄並同步隱私聲明。

## 自動化測試

```bash
npx vitest run          # PASS 354，FAIL 0
npm run typecheck       # tsc --noEmit 與 web/tsconfig.json 皆無錯誤
npm run build           # build:server 與 build:web 皆結束碼 0
```

`npm run build` 產出 `dist/web/index.html` 0.41 kB、`assets/index-hipNWysK.css` 51.38 kB、`assets/index-CidPxIOq.js` 340.97 kB。

## Migration 與零外鍵

```bash
npm run db:migrate      # 第一次：已套用至 0012
npm run db:migrate      # 第二次：資料庫 migration 已是最新狀態（冪等）
npm run db:check        # 資料庫連線正常
```

直接查詢 PostgreSQL 17 確認結構：

| 檢查項 | 結果 |
|---|---|
| `public` schema 外鍵數 | 0 |
| `package_version_script_targets` | 存在 |
| `script_target_revisions` | 存在 |
| `installations.script_version`、`installations.options` | 兩欄皆存在 |

零外鍵符合第一期「資料庫不建立外鍵、cascade 或 `.references()`」的全域限制。

## 真實 API 端到端驗收

以 `dev-admin` session 對執行中的後端與真實 PostgreSQL 執行，套件 `mysql-mcp`，**22 項全數通過**：

| 驗證項 | 結果 |
|---|---|
| 建立版本草稿 | HTTP 201 |
| 新增 `linux/macos × claude-code`、`windows × codex`、`wsl × claude-code` | 三組皆 HTTP 201 |
| 三組首次保存皆為 v1 且命令互不覆蓋 | 各自保留自己的 install 命令 |
| 同一 target 再次保存 | 遞增為 v2 |
| CAS 版本衝突 | HTTP 409 |
| 跨組合複製 | 帶 `copiedFrom`，命令與來源一致 |
| 複製後手動編輯 | `copiedFrom` 被清除 |
| 來源不受複製後編輯影響 | 來源仍為 `install linux v2` |
| 版本歷程重載 | 2 筆 revision |
| 軟刪除 | HTTP 200 且回傳 `deletedAt` |
| 重載後刪除組合不在 active | active 由 3 降為 2 |
| 重建同組合 | 沿用同一 target id、`currentRevision` 清空 |
| 重建後首次保存 | 續號至 v2，revision 未被刪除 |
| 選項名缺少 `--` 前綴 | HTTP 400 |
| 啟用殘留但未填說明 | HTTP 400 |
| 有待填組合時送審 | HTTP 409 `SCRIPT_TARGETS_INCOMPLETE` |
| 刪除待填組合後送審 | HTTP 200 |

送審閘門確認由 active target 的 current revision 導出，未出現 Cartesian product 推測。

## 瀏覽器驗收

以真實 Google Chrome（`--headless=new`，CDP 驅動）對 **production build** 執行，**17 項全數通過**：

| 驗證項 | 結果 |
|---|---|
| 以真實 session 載入 `/publish` | 通過 |
| Matrix、選項參數、使用說明、殘留聲明四個區塊 | 皆存在 |
| 顯示 `ASP_OPT_` 注入規則 | 存在 |
| Task 9.9 的「一次只能建立一個」限制文案 | 已移除 |
| 系統下拉 | `linux/macos`、`windows`、`wsl` |
| Client 下拉 | `claude-code`、`codex` |
| 1280×800 整頁橫向溢位 | scrollWidth 1280 ≤ innerWidth 1280 |
| 1024×768 整頁橫向溢位 | scrollWidth 1024 ≤ innerWidth 1024 |
| URL `?packageId=&version=` 重載草稿 | 通過 |
| UI 建立版本草稿 → 加入 WSL × Claude Code → 填命令 → 保存 | Matrix 列顯示 `bash · script v1` |
| 保存後檔名樣式 | `install-mysql-mcp-13.9.68634-wsl-claude-code-{userRef}-v1.sh` |
| 重新以 URL 載入 | WSL 列仍為 `script v1`，命令已持久化 |
| console 錯誤 | 無 |
| 失敗網路請求 | 無 |

## 開發模式的 ERR_ABORTED（非缺陷）

Vite dev server（`127.0.0.1:5173`）單次載入 `/publish` 時，`GET /api/packages?limit=100&sort=name_asc` 會出現一次 `net::ERR_ABORTED`。

原因：`web/src/main.tsx` 啟用 React `StrictMode`，開發模式下 effect 會被刻意掛載兩次；`usePageState` 的 cleanup 正確呼叫 `controller.abort()` 中止第一次請求，第二次掛載重新發出。這是 `AbortController` 正常運作的結果，不是請求失敗。

已用 production build（`node dist/server.js`，`127.0.0.1:3100`）單次載入 `/publish` 驗證：失敗請求為 0。因此正式環境不存在此現象，未修改產品邏輯。

## 第一期邊界與限制

- 驗收基準為 1024px 以上 PC，依全域規則不擴張手機版範圍。
- 舊 `package_versions` 的單一 `installCommand`／`uninstallCommand` 保留一個相容週期，僅供讀取；新寫入一律走 target/revision 端點，送審與驗證不接受 legacy imported revision。
- Migration 只回填「恰好一個正規化 OS 且一個受支援 Client」的舊資料；語意含糊的多目標舊列不建立 target 紀錄，需人工補齊。
- 隱私邊界：本次僅驗證工程面白名單、遙測欄位與 `PrivacyPage` 三者一致。**對外書面隱私核准仍是正式上線的前置條件，尚未取得，不因本次驗收視為完成。**

## 技能搜尋紀錄

本任務未執行新的技能搜尋，沿用 Task 9.8／9.9 已審核的既有流程（`frontend-design`、測試驅動、瀏覽驗收）。未安裝任何技能，`skills-lock.json` 不變。

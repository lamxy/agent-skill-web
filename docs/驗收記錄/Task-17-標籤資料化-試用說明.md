# Task 17 技能標籤資料化 試用說明

技能池的來源、發布者、分類、分級四組標籤已由寫死值改為真實資料，列表篩選器同步啟用。

本文所有埠與位址均對照專案 `.env` 與 `vite.config.ts` 實際設定，未做任何覆寫。

## 環境前提

| 項目 | 值 | 來源 |
|---|---|---|
| 後端埠 | `3000` | `.env` 的 `PORT` |
| 前端埠 | `5173` | `vite.config.ts` 的 `server.port` |
| 模擬 IdP 埠 | `4780` | `.env` 的 `OIDC_*_URL` |
| 資料庫 | `127.0.0.1:55432` | `.env` 的 `DATABASE_URL` |
| 管理員帳號 | `mock-admin` | `.env` 的 `BOOTSTRAP_ADMIN_UID` |

**入口是 5173，不是 3000。** `.env` 的 `OIDC_REDIRECT_URI` 指向 `http://127.0.0.1:5173/api/auth/callback`，
且 `vite.config.ts` 把 `/api` 代理到 `127.0.0.1:3000`。從 3000 直接進去不會有登入回呼。

後端埠不要用環境變數覆寫。Vite 的代理目標硬編碼為 3000，改了後端埠會讓前端找不到 API。

## 啟動

四個終端，依序執行。

資料庫容器 `agent-skill-platform-dev-postgres-1` 常駐執行，不需要每次啟動。
確認即可，沒回應才用 `docker compose up -d` 拉起。

```bash
# 1. 確認資料庫可用
npm run db:check          # 應輸出「資料庫連線正常」

# 2. 重建示範資料（套用 migration 並載入五個示範技能）
npm run demo:reset

# 3. 模擬 IdP，登入流程所需
npm run dev:idp

# 4. 後端（另一個終端）
npm run dev

# 5. 前端（另一個終端）
npm run dev:web
```

瀏覽器開 <http://127.0.0.1:5173>，以 `mock-admin` 登入即具備管理員權限。

## 該看哪裡

| 位置 | 看什麼 |
|---|---|
| 技能池首頁 | 每筆左側標籤帶，順序為「分級 · 分類 · 來源」；下方一行為「發布者類型·發布者名稱 · 所有團隊」。分級篩選器過去停用，現在可用；另新增分類與來源兩個篩選器 |
| 發布技能 | 分類由自由文字改為固定選項；新增「來源」與「發布者類型／名稱」欄位。表單刻意沒有分級欄位 |
| 審核詳情頁 | 最下方新增「技能分級」面板。只有審核人能核定，維護者呼叫回 403。核定後回技能池可見列表標籤變化 |
| 技能詳情頁 | 採用漏斗的下載數仍標示「未埋點」，屬 Task 18 |

## 示範資料

五筆刻意在四組標籤上錯開，照此表試篩選器可確認每個條件都生效。

| 技能 | 分級 | 分類 | 來源 | 發布者 |
|---|---|---|---|---|
| `superpowers` | 全員推廣 | 通用 | 開源 | 組織 · 公共架構 |
| `mysql-mcp` | 精品 | 資料 | 開源 | 組織 · 資料庫平台 |
| `pm-skill` | 精品 | 產品設計 | 自定義 | 個人 · 張三 |
| `trace-lens` | 對外開源 | 後端 | 開源 | 個人 · 李四 |
| `deploy-runner` | 基礎 | 部署運維 | 自定義 | 組織 · SRE |

分級的著色有規則：只有需要引導採用的分級才上色，「基礎」與「通用」維持中性，
避免整張列表都在強調。

## 直接驗後端

本機 shell 有 `HTTP_PROXY`，打本機位址必須加 `--noproxy '*'`，否則請求會繞去代理而掛住。

```bash
curl -s --noproxy '*' 'http://127.0.0.1:3000/api/packages?grade=premium'
curl -s --noproxy '*' 'http://127.0.0.1:3000/api/packages?source=opensource'
curl -s --noproxy '*' 'http://127.0.0.1:3000/api/packages?categoryCode=devops'
curl -s --noproxy '*' 'http://127.0.0.1:3000/api/packages?grade=bogus'   # 應回 400
```

非法列舉值回 `400` 而非默默忽略，是刻意的。

## 開發模式的預期現象

Vite dev server 載入資料頁時，每個 API 請求會出現一次 `net::ERR_ABORTED`。
這是 React StrictMode 雙掛載加上 `AbortController` 正常運作，不是缺陷。

要驗收「無失敗請求」須改用 production build：

```bash
npm run build
npm start                 # 服務於 3000，此時不經 Vite，直接開 http://127.0.0.1:3000
```

注意 production build 模式下入口是 3000（Fastify 靜態託管建置產物），
但 `OIDC_REDIRECT_URI` 仍指向 5173，因此該模式下登入流程需另行調整 `.env`。
只看列表與標籤不需登入。

## 已知邊界

| 項目 | 狀態 |
|---|---|
| 下載數埋點 | 未做，屬 Task 18。列表與詳情均標示「未埋點」，不以估算值填充 |
| 舊 `category` 欄位 | 保留為 legacy 顯示標籤。新增的 `category_code` 才是篩選真實來源；舊值已複製到 `publication_reviews` 與 `reviewer_assignments`，直接改造會牽動三張表 |
| PowerShell 相關測試 | 3 項失敗，與本次改動無關，改動前同樣失敗（已用 `git stash` 確認）。其餘 627 項通過 |
| 變更尚未 commit | 全部在工作區 |

決策與理由記錄於 `docs/全局開發記憶.md` 的 2026-08-30 章節。

# Task #2 身份與權限驗收記錄

驗收日期：2026-08-25

## 需求與證據

| 需求 | 結論 | 直接證據 |
| --- | --- | --- |
| 已登入使用 UID，未登入生成並持久化 UUID | 通過 | `SessionService.resolve()`、匿名 Cookie API 測試、`toInstallationUserReference()` 兩個分支測試 |
| 匿名 UUID 不得誤標為 UID | 通過 | `ResolvedIdentity` 與 `InstallationUserReference` 均為判別式聯合型別；測試確認匿名結果沒有 `uid` |
| 第一期身份、session、角色、審核人與 API 功能閉環 | 通過 | 服務端 opaque session、四種角色、`hasRole()`、`canReview()`、六個身份／管理 API；Vitest 全量通過 |
| 正式 OIDC 延後且保留擴展邊界 | 通過 | `IdentityProvider` 介面接受 `development | oidc | disabled`；production／staging 預設 disabled，正式未配置時測試證明回 503 |
| 本地 provider 只用於 development／test | 通過 | `DevelopmentIdentityProvider` 固定 fixture；模組會拒絕 production／staging 注入 development provider |
| 角色可疊加 | 通過 | `authorization-service.test.ts` 同一 UID 同時驗證 employee 與 reviewer |
| 平臺管理員按套件類型／分類指定審核人 | 通過 | POST／DELETE API 整合測試與記憶體／PostgreSQL repository 測試 |
| 作者／同團隊迴避 | 通過 | `canReview()` 先檢查 identity `teamIds` 快照與 package `ownerTeam`；同團隊拒絕、不同團隊允許均有測試 |
| 指派／撤銷寫入稽核事件 | 通過 | PostgreSQL 真實交易測試證明 `reviewer.assigned` 與 `reviewer.revoked` 各一筆；重複撤銷不重複寫事件 |
| 資料庫無外鍵、cascade、`.references()` | 通過 | Drizzle table config 測試；`src/`、`drizzle/` 掃描無命中；PostgreSQL `pg_constraint` 實查外鍵數量 0 |
| Migration 可安全重跑 | 通過 | `0000`、`0001` 首次套用後再次執行回報「資料庫 migration 已是最新狀態」 |
| 基本安全線 | 通過 | session 只落 SHA-256 摘要；Cookie 為 HttpOnly/SameSite=Lax、production Secure；輸入 schema、伺服器端 authz、通用錯誤與站內 returnTo |

## 驗證命令與結果

```text
rtk npm run typecheck
→ tsc --noEmit，退出碼 0

rtk npm run build
→ tsc -p tsconfig.build.json，退出碼 0

rtk npm test
→ 8 個測試檔通過，32 個測試通過，0 失敗

rtk env DATABASE_URL=... NODE_ENV=test npm run db:migrate
→ 資料庫 migration 已是最新狀態

rtk env DATABASE_URL=... NODE_ENV=test npm run db:check
→ 資料庫連線正常

rtk docker compose exec -T postgres psql ... pg_constraint ...
→ 0
```

## 真實組裝冒煙測試

使用 build 產物、`createApp()` 預設模組組裝與 WSL Docker Desktop 的 PostgreSQL 17 執行：

```json
{"login":302,"callback":302,"me":200,"kind":"authenticated","uid":"dev-admin","roles":["platform_admin"]}
```

冒煙輸出只包含狀態、身份類型、測試 UID 與角色；沒有輸出 Cookie 或 session Token。

## 第二期保留項目

真實 OIDC Authorization Code + PKCE、state／nonce、JWKS、issuer／audience、MFA、Refresh Token 輪替、完整 CSRF 與集中速率限制仍屬第二期。第一期沒有用開發 provider 冒充上述能力。

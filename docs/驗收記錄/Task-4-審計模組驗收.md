# Task #4 審計模組驗收記錄

驗收日期：2026-08-25

## 需求證據

| 需求 | 結論 | 直接證據 |
| --- | --- | --- |
| 結構化 AuditLog | 通過 | `AuditLog` 包含事件、actor、target、action、JSONB details、可選 IP／User-Agent 與時間；記憶體及 PostgreSQL寫入測試 |
| 審核與權限變更事件 | 通過 | reviewer 指派／撤銷各產生 `reviewer.assigned`／`reviewer.revoked` Audit |
| 與業務操作同交易 | 通過 | 整合測試強制 Outbox INSERT 失敗，reviewer 指派與 Audit 都不存在 |
| 不可變、只 INSERT | 通過 | 真實 PostgreSQL UPDATE 與 DELETE 都由 trigger 以 `55000` 拒絕，原始 action 保持不變 |
| 管理員查詢 API | 通過 | `GET /api/audit/logs`；platform_admin 200、一般使用者 403、匿名 401 |
| 組合過濾 | 通過 | 事件類型、actor、target type/id、from/to 的服務及 API 測試 |
| 穩定分頁 | 通過 | `occurredAt + id` 游標測試證明第二頁無重複；limit 1–100 |
| 反範式、無外鍵 | 通過 | Drizzle metadata 與 PostgreSQL 系統目錄均證明外鍵數量 0 |

## 驗證結果

```text
rtk npm run typecheck
→ 退出碼 0

rtk npm run build
→ 退出碼 0

rtk npm test
→ 11 個測試檔、43 個測試通過，0 失敗

rtk env DATABASE_URL=... NODE_ENV=test npm run db:migrate
→ 資料庫 migration 已是最新狀態

PostgreSQL 系統目錄
→ {"foreign_keys": 0, "audit_immutable_triggers": 1}
```

## 真實組裝冒煙

使用 build 產物與 WSL Docker Desktop PostgreSQL 17：

```json
{"reviewerLogin":302,"adminLogin":302,"assigned":201,"auditQuery":200,"auditCount":1,"eventType":"reviewer.assigned","actorUid":"dev-admin"}
```

輸出沒有 Cookie、session Token 或其他敏感資料。

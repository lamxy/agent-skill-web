# Task #8 分析頁驗收

日期：2026-08-26

## 功能與文件核對

- `GET /api/packages/:packageId/analytics?start&end` 已在文件定義嚴格 RFC 3339、合法日曆日期、`start <= end` 與 `startedAt` 閉區間。
- 授權只允許版本作者、owner team maintainer 或 platform admin；匿名為 401、其他登入者為 403。
- 報表明確分開 UID／UUID 成功率與 Wilson 95% 信賴區間，包含按 version／OS／error code 的一維失敗分布與 heatmap、雙時間口徑、活躍版本、相容環境的 UID 升級候選與下載事件缺口。
- 匿名請求已在任何 repository 讀取前拒絕；已登入請求先讀 metadata 並授權，通過後才載入期間 telemetry。期間上限為 366 天。
- 首次可運行時間已改為分組、單次排序與 binary search；10,000 組下載／成功的已知資料集覆蓋結果與寬鬆效能門檻。
- 同時間狀態已固定依 `startedAt → endedAt → receivedAt → id` 折疊；版本先按「有效 SemVer／非 SemVer」固定類別形成可傳遞總序，同類內分別使用 SemVer 與 natural comparator。`1.0.0`、`1.0.0-alpha`、`1.0.0-` 的六種輸入排列均選出相同推薦版。
- `GET /api/me/installations` 只讀登入 UID 的目前活躍安裝；UUID 不出現在個人安裝清單或可通知升級候選。
- README、API、架構與全局記憶均標示 `best-effort` 與「數據僅供參考」，並完成歸檔線框畫面 3 的區段映射。資料模型維持邏輯 ID、零外鍵及查詢索引。

## 最新驗證

| 順序 | 命令 | 實際退出結果 | 結果 |
| --- | --- | --- | --- |
| 1 | `rtk npm test -- test/analytics/analytics-service.test.ts test/analytics/analytics-api.test.ts test/analytics/postgres-analytics-repository.test.ts` | 0；3 個測試檔、27 項測試通過。 | 通過 |
| 2 | `rtk npm test -- test/analytics/postgres-analytics-repository.test.ts` | 0；1 個測試檔、3 項測試通過，包含 start／end 閉區間及索引 definition 欄位順序。 | 通過 |
| 3 | `rtk npm test -- test/analytics/analytics-service.test.ts -t '大型同鍵資料集仍配對最近前序下載並在寬鬆時限內完成' --reporter=verbose` | 0；10,000 組下載／成功的單項測試耗時 206 ms。 | 通過 |
| 4 | `rtk npm test` | 0；28 個測試檔、219 項測試通過，總耗時 72.08 秒。終端 session 持續輪詢至真實退出。 | 通過 |
| 5 | `rtk npm run typecheck` | 0 | 通過 |
| 6 | `rtk npm run build` | 0 | 通過 |
| 7 | `rtk git diff --check` | 0；無輸出。 | 通過 |

本專案 Compose PostgreSQL 在驗證期間可用，PostgreSQL analytics 整合測試包含 migration 啟動與查詢契約。全量測試、typecheck、build 與 diff check 均在最終修正後取得 exit 0。

## 收尾狀態

最終 comparator 修正已提交為 `bc22996 fix: 固定混合版本推荐顺序`。全部驗證通過後再次執行 `task-master set-status --id=8 --status=done`，Task #8 由 `in-progress` 回到 `done`；文件、驗收證據與 Task Master 時間戳由後續收尾提交保存。

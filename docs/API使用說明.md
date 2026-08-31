# API 使用說明

服務啟動後以 `/docs` 查看 Swagger UI，以 `/docs/json` 取得 OpenAPI 3.0.3 文件。本文只列第一期核心流程；欄位、狀態碼與 schema 以即時 OpenAPI 為準。

## 生成腳本

```http
POST /api/packages/{packageId}/versions/{version}/scripts
Content-Type: application/json

{"targetOs":"linux","clientRuntime":"codex","action":"install"}
```

`targetOs` 只接受 `linux`／`windows`，WSL 終端選擇 `linux`；`clientRuntime` 只接受版本已聲明的 `codex`／`claude-code`。只有可見且已發布版本可生成。回應包含 `script`、`digest`、`preview` 與 `telemetryAssurance: "best-effort"`。

## 遙測上報

```http
POST /api/telemetry/report
Content-Type: application/json
```

端點不依賴 Cookie session。白名單固定十一欄：`idempotency_key`、`package_id`、`version`、`user_ref`、`user_ref_type`、`os_type`、`client_runtime`、`status`、`error_code`、`start_time`、`end_time`。首次事件回 201；同 key 同內容回 200 duplicate；同 key 不同內容回 409。

## 目錄與治理

目錄、版本、下載、審核、通知、身份與 Audit 端點均已登記在 OpenAPI。寫入端點需要伺服器端授權；不要把 UI 是否顯示按鈕當成權限控制。

## 採用分析

```http
GET /api/packages/{packageId}/analytics?start=2026-08-25T00:00:00.000Z&end=2026-08-25T23:59:59.999Z
Cookie: asp_session=<登入 session>
```

`start` 與 `end` 必填，接受有時區的 RFC 3339 日期時間；正規表示式、日曆日期與時間範圍都會嚴格驗證。任何格式錯誤、不存在日期、`start > end` 或期間超過 366 天都回 `400 INVALID_ANALYTICS_PERIOD`；超限訊息固定為「分析期間不得超過 366 天」。查詢以事件的 `startedAt` 為準，條件是 `start <= startedAt <= end`；`receivedAt` 只代表伺服器收到遙測的時間，不能用來補入晚到事件。

身份邊界是伺服器端授權：任一套件版本作者、該套件 `owner_team` 中同時具有 team-scoped `maintainer` 角色的登入者，或 global `platform_admin` 可讀；匿名回 `401 AUTHENTICATION_REQUIRED`，其他登入者回 `403 FORBIDDEN`，不存在套件回 `404 PACKAGE_NOT_FOUND`。匿名請求不讀 repository；已登入請求只先讀套件與版本 metadata，通過授權後才載入期間 telemetry，避免越權者觸發寬資料查詢。

回應的核心欄位如下：

- `funnel`：`downloaded`、`succeeded`、`uninstalled` 事件數與兩個比率；分母為零時比率是 `null`。
- `successRates.uid`、`successRates.uuid`：只以 `succeeded`／`failed` 終態事件計算，各自回傳成功數、總數、比率與 Wilson 95% 信賴區間；兩種身份不能合併為單一成功率，零樣本的比率與區間均是 `null`。
- `failureDistribution.byVersion`、`byOs`、`byErrorCode`：同一輪掃描失敗事件後產生的三組一維聚合，前端不必從交叉表重算。
- `failureDistribution.heatmap`：以 `version + osType + errorCode` 聚合的交叉 cells；缺少錯誤碼時使用 `E999`。`failureCells` 暫時保留為相同 heatmap 的相容欄位。
- `timeToRunnable.platform`：每筆成功事件的 `endedAt - startedAt`；`employee`：同套件、身份類型、使用者、版本中，最近且不晚於成功事件的 `downloaded.startedAt` 到成功 `endedAt`。兩者都回傳樣本數、median、P90、P95（毫秒）；`employee.approximate` 永遠為 `true`，缺下載配對不以平台時間補齊。
- `versionDistribution`：把期間內成功安裝折疊為目前活躍版本，後續 `uninstalled` 會移除該使用者／套件；不是累積歷史安裝量。
- `upgradeCandidates`：只含 UID；目前版本低於最高的 `published` 版，且該建議版同時支援其最後成功安裝的 OS 與 client runtime。版本先按固定類別形成總序：有效 SemVer 在前、非 SemVer 在後；有效 SemVer 依規格比較，非 SemVer 依 natural comparator 比較，因此混合標籤的推薦版不受資料庫回傳順序影響。UUID 無法通知，不列入候選。
- `telemetryAssurance: "best-effort"` 與 `dataNotice: "數據僅供參考"`：必須直接呈現給讀者。`dataGaps` 只比較成功／失敗終態與下載事件，不把 `uninstalled` 當成獨立安裝基線或製造 `MISSING_DOWNLOAD_EVENTS`；缺口仍只能作趨勢提示，不能推論完整母體。

```http
GET /api/me/installations
Cookie: asp_session=<登入 session>
```

此端點只接受登入 session，匿名回 `401 AUTHENTICATION_REQUIRED`。它只讀取該 UID 的遙測，折疊成功／解除安裝事件後，對每個目前活躍套件回傳 `packageId`、`packageName`、`currentVersion`、固定 `status: "installed"`、最高已發佈的 `availableVersion` 與 `upgradeAvailable`。這是員工視角，不是作者的 UID／UUID 全量分析。

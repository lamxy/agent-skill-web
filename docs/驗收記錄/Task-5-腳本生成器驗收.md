# Task 5：腳本生成器驗收

## 完成範圍

- Linux Bash 與 Windows PowerShell 生成器，Client 首期驗證 Codex／Claude Code；資料與 API 可擴展其他 runtime。
- 平台不可變頭部保存腳本版本、套件／版本、冪等鍵、開始時間、uid／UUID、OS、Client 與服務端遙測端點。
- 維護者命令來自 PackageVersion 的 UI 保存欄位；平台不硬編碼中部。
- install／uninstall 分別生成，解除成功回報 `uninstalled`；殘留為 true 時強制殘留說明與人工清理步驟。
- 平台尾部只上報白名單欄位；HTTP 上報失敗寫入 `~/.agent-platform/pending_reports.jsonl`，不改變原始退出碼。
- 完整腳本回傳 `sha256:` digest，`verify()` 可檢出任何內容篡改。
- 執行前預覽包含安裝／解除安裝命令、殘留影響與遙測欄位。

## 防繞過

- Linux 命令在子程序執行；中部 `exit 23` 後父層仍以 `failed/exit_23` 上報並以 23 結束。
- 平台變數與 endpoint 在父層 readonly；拒絕 `trap`、`exec`、`source`、`_ASP_` 與 endpoint 改寫。
- PowerShell 以 `try/catch/finally` 保證尾部執行，拒絕保留變數與事件攔截改寫。
- API 不接收 telemetry endpoint，只能使用服務端 `TELEMETRY_ENDPOINT`。

## 分發 API

`POST /api/packages/:packageId/versions/:version/scripts` 只接受已發佈且呼叫身份可見的版本。`targetOs` 或 `clientRuntime` 未在版本中聲明時回 409；待審版本回 404。

## 驗證證據

```text
定向測試：Linux／Windows × Codex／Claude Code、digest、防繞過、成功／失敗遙測、卸載與 API 分發通過
PowerShell：7.6.4 真實執行通過
全量回歸：16 個測試檔、65 個測試通過
TypeScript typecheck：通過
正式 build：通過
Migration 0005：已套用
```

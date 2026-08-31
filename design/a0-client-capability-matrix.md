# A0 / Q0：候選 Client 兜底能力查證

**Date**: 2026-08-12
**執行項**: PRD § Phase A 前置 A0（Q0）
**目的**: 確認候選 Agent 客戶端是否提供三項兜底能力，作為 Q1（Client 選擇）的篩選條件
**方法**: 讀取各客戶端官方文檔原始內容（非搜尋摘要）；Gemini CLI 為開源，直接讀 repo 源文件

## 三項篩選條件（來自 PRD A0）

| 代號 | 能力 | 用途 |
|---|---|---|
| (a) | 簽名 Check-in 或等價生命週期 hook | M9 緊急禁用確認、C15b |
| (b) | Plugin 載入 Usage Ping | M8 活躍版本分布、C13b |
| (c) | 可驗證的 Plugin 停用接口 | C15b 停用已安裝版本 |

---

## 結論摘要

| Client | (a) 週期性 Check-in | (b) 載入 Usage Ping | (c) 可驗證停用 | Q0 判定 |
|---|:---:|:---:|:---:|:---:|
| **Claude Code** | ✗ 無定時器 | △ 間接可得 | ✓ managed settings | **部分通過** |
| **Codex CLI** | ✗ 無定時器 | △ 間接可得 | ✓ requirements.toml | **部分通過** |
| **Gemini CLI** | ✗ 無定時器 | △ 間接可得 | ✓ 系統層 settings | **部分通過** |
| **GitHub Copilot CLI** | ✗ 無本機 hook | ✓ 服務端遙測 | ✓ 企業 policy | **部分通過（路徑不同）** |
| **Cursor** | ✗ 無 hook 系統 | ✗ | ✓ MDM AllowedExtensions | **不通過** |

> **關鍵發現：五個候選全部不提供 (a) 週期性簽名 Check-in。**
> 這不是選錯 Client 的問題——**沒有任何主流 Agent 客戶端提供這個能力**。
> 原因是架構性的：這些客戶端都是「事件驅動的本機 CLI 進程」，沒有常駐 agent 或定時器概念。

---

## 逐項證據

### Claude Code

**(a) 週期性 Check-in — 無。**

官方 hooks 文檔列出 31 個 hook 事件（`SessionStart`、`PreToolUse`、`PostToolUse`、`Stop`、`SessionEnd`、`InstructionsLoaded`、`SubagentStart` 等）。文檔明確說明：

> 所有 hooks 都是 **event-driven**，僅在特定使用者動作或 Claude Code 生命週期事件時觸發。沒有任何 hook 週期性或依定時器觸發。

**替代路徑（重要）**：Plugin 支援 `monitors/monitors.json` 背景監視器，其 `command` 可為持續運行的輪詢腳本（如 `poll-deploy.sh`），每行 stdout 送給 Claude 作為通知。

- 限制：僅在**互動式 CLI session** 中運行、unsandboxed、標記為 experimental component、在不支援 Monitor tool 的主機上被跳過。
- 這可以實現「session 期間每 5 分鐘拉取 Revocation List」，但**只在 session 存活期間**——關閉客戶端即停止。

**(b) 載入 Usage Ping — 間接可得。**

無 plugin 載入專用 hook（最接近的 `InstructionsLoaded` 只針對 CLAUDE.md 與 `.claude/rules/*.md`）。但可由 plugin 自帶 `SessionStart` hook 在 session 開始時上報一次，等價於「載入即 ping」。

**(c) 可驗證停用 — 有，且是五者中最完整的。**

- Plugin 安裝 scope 含 `managed`（對應 managed settings），文檔標示為 **read-only, update only**。
- `enabledPlugins` 可在 managed settings 層設定，且**managed settings 優先於 `--settings` 與 user settings**。
- 文檔明確指出：`--plugin-dir` **無法覆蓋** managed settings 強制啟用或強制停用的 plugin。
- 另有 `strictKnownMarketplaces`、`blockedMarketplaces` 可從來源層阻斷。

> 這是真正的遠端停用能力，但**生效時點為下次讀取 settings 時**（session 啟動或 `/reload-plugins`），非即時；且**無回執機制**。

---

### Codex CLI

**(a) 週期性 Check-in — 無。**

hook 事件：`SessionStart`（startup/resume/clear/compact）、`SessionEnd`（archive/delete/close/**30 分鐘閒置逾時**）、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`UserPromptSubmit`、`Stop`、`PreCompact`、`PostCompact`、`SubagentStart`、`SubagentStop`。

文檔確認：**無 timer-based 事件**。

**(b) 載入 Usage Ping — 間接可得。** 同 Claude Code，可用 `SessionStart` 等價替代。Plugin 可透過 manifest 或 `hooks/hooks.json` 綁定生命週期 hook。

**(c) 可驗證停用 — 有，企業控制面完整。**

`requirements.toml`（僅限此檔，`config.toml` 不支援）：
- `allow_managed_hooks_only = true` — 忽略 user、project、session hook 設定，僅載入 managed hooks
- `[features] hooks = false` — 全域關閉 hooks
- 來自 system、MDM、cloud 或 `requirements.toml` 的 hooks 標記為 **managed，依政策受信任，使用者無法從 hook browser 停用**
- 可強制約束 `approval_policy`、`sandbox_mode`

> 注意：Guardian review session 期間 hooks 被停用（v0.121.0）——若依賴 hook 做審計上報，此為盲區。

---

### Gemini CLI

**(a) 週期性 Check-in — 無。**

hook 事件（讀自 `docs/hooks/reference.md` 源文件）：`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`BeforeModel`、`BeforeToolSelection`、`AfterModel`、`SessionStart`、`SessionEnd`、`Notification`、`PreCompress`。無定時器事件。

**(b) 載入 Usage Ping — 間接可得。**

`SessionStart`（source: startup/resume/clear）可上報。注意 `SessionEnd` 為 **best effort——CLI 不等待其完成**，不可用於保證送達的上報。

**(c) 可驗證停用 — 有，但有明確的自我聲明缺口。**

- 系統層 settings.json 可設 `security.auth.enforcedType` 等；extension 可貢獻 Policy Engine 規則（`.toml`）
- **官方文檔自己聲明**：這些模式**不是 foolproof security boundary**，具備本機權限的使用者可繞過；設計目的是防止意外誤用與執行公司政策，**不是防禦具本機管理員權限的惡意行為者**
- `GEMINI_CLI_SYSTEM_SETTINGS_PATH` 環境變數可指向他處以繞過中央設定；官方建議的緩解是 wrapper script／alias

> 對本平台的意義：Gemini CLI 的停用能力在「非惡意員工」場景成立，在「防止刻意規避」場景不成立。若 Pilot 1 的威脅模型只含誤用不含對抗，仍可接受。

---

### GitHub Copilot CLI

**路徑與其他四者根本不同：控制在服務端而非本機。**

**(a) 週期性 Check-in — 無本機 hook 機制**，但服務端遙測提供近似能力。

**(b) Usage Ping — ✓ 唯一原生具備者。**

- Copilot usage metrics 涵蓋 IDE、**Copilot CLI**、agent apps 活動
- 事件來自 client-side **與 server-side** 遙測；文檔明確指出 server-side 遙測能識別 client-side 遺漏的活躍使用者
- REST API endpoints for Copilot metrics 可程式化取得
- `last_activity_at` 保留 90 天，**不可修改**

**(c) 可驗證停用 — ✓ 企業 policy 層。**

- 企業／組織層級 enable/disable，policy 變更記錄進 **enterprise audit log**
- MCP allowlist policy＋MCP registry URL
- 優先級：「Enabled/Disabled everywhere」覆蓋組織層設定；跨企業時**最嚴格者幾乎總是生效**

**但有三個對本平台致命的缺口：**

1. **CLI extensions 的遙測不受企業控制** — 文檔明確：GitHub CLI extensions（含第三方與 agents）**可能自行收集使用數據，且不受 opt-out 控制**，必須逐一查閱各 extension 文檔
2. `COPILOT_OFFLINE=true` 可由**使用者**關閉全部遙測 → M8 分母隨時可能被使用者單方面破壞
3. 使用者可自帶 LLM key，**不受企業政策控制**

---

### Cursor

**(a) 無 hook 系統** — 未發現等價於前四者的生命週期 hook 機制。
**(b) 無 per-extension 使用遙測回報給管理員** — 查證文檔未涵蓋此項。

**(c) 可驗證停用 — 有，且 MDM 層強度高。**

- MDM `AllowedExtensions` policy（JSON string，定義允許的 publisher 與 extension）
- **覆蓋** admin portal 設定與使用者本機 `extensions.allowed`
- 團隊 dashboard（Security & Identity）可設 allowlist，自動下發至所有成員；**需 Cursor client ≥ 2.1**
- 另有 Marketplace Install Cooldown、Require Extension Signature Verification

**已知陷阱（文檔明載）**：清空 admin portal 欄位**只停止推送新值，不移除客戶端已套用的本機政策**。要全體重置須先下發 `{"*": true}`，等客戶端接收後再清空。

**未能查證**：政策對**已安裝** extension 是否即時生效、是否需重啟、**有無套用回執**、有無 per-extension 使用遙測。官方文檔未涵蓋。

---

## 對 PRD 的影響（需要決策）

### 觸發的是 PRD 條件式 P0 決策表的第三列

現有決策表：

| Q0 結果 | C13b | C15b | M8 | M9 |
|---|---|---|---|---|
| 兩者皆有 | 納入 | 納入 | 保留 | 保留 |
| 僅其一 | 按對應項 | 按對應項 | 按對應項 | 按對應項 |
| **兩者皆無** | **移出** | **移出** | **移除** | **移除** |

但實際結果比「兩者皆無」更細緻，需要修正決策表的維度：

- **(c) 停用能力：五者皆有**（強度與生效時點不同）→ C15 的核心可保留
- **(a) 週期性簽名 Check-in：五者皆無** → **M9 的 10 分鐘 SLO 無論選哪個 Client 都不成立**
- **(b) Usage Ping：Copilot 原生具備；其餘三者可用 `SessionStart` 間接實現；Cursor 無**

### 三項待決事項

**決策 1｜M9 必須改寫，這不是選型問題。**

10 分鐘緊急禁用 SLO 的前提（5 分鐘簽名 Check-in）在**所有候選 Client 上都不存在**。可行的替代表述：

- 「禁用政策下發後，於下一次 session 啟動時生效」——這是五者的共同能力上限
- 若採 Claude Code 的 `monitors` 輪詢：可達成「session 存活期間 N 分鐘內生效」，但無法涵蓋已關閉的客戶端，且該機制為 experimental
- 對應 PRD § Degraded Mode 的 D5：平台應聲明禁用能力上限為「阻止新安裝 + 下次啟動時停用」，而非「即時停用」

**決策 2｜(b) 的間接實現是否接受。**

`SessionStart` hook 上報不等於「Plugin 載入 Usage Ping」，但對 M8（活躍版本分布）而言足夠——它證明「該使用者在該時點啟動了含此 plugin 的 session」。
需確認：這是否滿足 Metric Contract 對「活躍安裝」的定義（現定義為「最近 30 天回報一次可驗證 Usage Ping」）。

**決策 3｜Cursor 應否留在候選名單。**

Cursor 三項中僅 (c) 成立，且 (a)(b) 無替代路徑（無 hook 系統）。若 Pilot 1 選 Cursor，M8／M9／C13b／C15b 全部移出範圍。

**已按公司 Client 優先級解決**：Cursor 屬 P2「保留擴展」層，本就不在 Pilot 1 的優先保證範圍（P0 為 Claude Code、Codex）。其能力缺口與此優先級一致，不需額外決策——保留為 F12 的 Adapter 建設對象。

**建議的 Pilot 1 候選收斂**：P0 兩者（Claude Code、Codex）在 (b)(c) 上能力對等，(a) 同樣缺失。選擇應由 **A0d（`superpowers` 官方適配範圍）** 與 **Pilot 0 的公司實際分布** 決定，而非本次能力查證——因為能力維度上兩者無差異。

### 額外發現：Package 的 Client 支援範圍是一級屬性

**`superpowers` 的技術現實**：它是 Claude Code 生態的 plugin（`.claude-plugin/plugin.json`＋`skills/*/SKILL.md`）。Codex、Gemini、Copilot、Cursor 各有**互不相容**的擴展格式。

> **修正（2026-08-12）**：本節初稿寫作「Client 選擇已被試點 Package 鎖定」，該表述不準確。
> 正確理解是：**每個 Package 有自己的 Client 支援範圍，該範圍隨適配工作演進**——官方適配決定初始範圍，公共架構或個人的內部適配可擴展它。
> 因此這不是平台的結構性限制，而是 Package 在某一時點的屬性。平台的職責是如實表達當前範圍並隨之演進。
> 對應 PRD § Client 支援範圍模型（`adaptation_source`: official / internal / community）。

**對 Pilot 1 的實際影響**：Client 選擇受**雙重約束**——
1. 落在 `superpowers` 當前支援範圍內（由 Package 決定，見 PRD A0d）
2. 通過 A0 兜底能力篩選（由平台需求決定，本文件）

兩者交集若為空，須先實現 `internal` 適配或更換試點 Package，不得跳過任一項。

**公司 Client 優先級**（PRD 已納入）：P0 優先保證 Claude Code、Codex；P1 涵蓋 GitHub Copilot、Gemini；P2 保留擴展 Cursor、Antigravity CLI、OpenCode、Pi 等。本次查證覆蓋了 P0 與 P1 全部四個，加上 P2 的 Cursor。

> 建議把「`superpowers` 官方適配了哪些 Client」送入 **A0d**，把打包格式差異送入 **Q3** 與 **Technical Spike B1** 的範圍。

---

## 未查證項（證據邊界）

以下為本次未能從官方文檔確認者，**不以推測填補**：

1. Cursor 政策對已安裝 extension 的生效時點、是否需重啟、有無回執
2. 各 Client 的 managed settings 下發延遲實測值（文檔均未提供 SLO）
3. Claude Code `monitors` 在企業環境的實際可用性（標記為 experimental，且「在不支援 Monitor tool 的主機上被跳過」——未查證哪些主機不支援）
4. Codex `requirements.toml` 的 MDM 下發機制細節
5. 公司實際使用的客戶端版本分布（此為 Pilot 0 A1 的觀察項，非文檔可得）

## 來源

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference)
- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [Gemini CLI hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md)（源文件 SHA `14846fe`）
- [Gemini CLI enterprise](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/enterprise.md)
- [Administering Copilot CLI for your enterprise](https://docs.github.com/en/copilot/how-tos/copilot-cli/administer-copilot-cli-for-your-enterprise)
- [GitHub Copilot usage metrics](https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics)
- [GitHub CLI telemetry](https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry)
- [Cursor Extensions](https://cursor.com/help/customization/extensions)
- [Cursor Identity and Access Management](https://cursor.com/docs/enterprise/identity-and-access-management)

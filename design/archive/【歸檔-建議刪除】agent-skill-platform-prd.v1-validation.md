# Product Requirements Document: 企業 Agent 技能交付與治理平台（Pilot 0 → Pilot 1）

**Author**: xspacemove77
**Date**: 2026-08-11
**Status**: Draft
**Source Design**: [agent-skill-platform-design.md](./agent-skill-platform-design.md)（Status: APPROVED, 2026-08-04）
**Risk Analysis**: [agent-skill-platform-premortem.md](./agent-skill-platform-premortem.md)（2026-08-12）— 本 PRD 已納入其 4 條 launch-blocking Tiger 與 5 條 Elephant 的處置
**Stakeholders**: 公共架構技術賦能團隊（Owner）、安全、DBA、法務／開源辦公室、產品／前端／後端員工代表

---

## 1. Executive Summary

為互聯網企業內部員工建立 Agent 技能交付控制面，把技能從「分享會＋Wiki＋群聊＋作者人工支援」的口耳相傳模式，轉為可預檢、可安裝、可診斷、可回滾、可觀測的交付交易。

第一階段不做技能社區，只驗證單一閉環：公共架構技術賦能工程師能以可重複方式交付 `superpowers`，員工能一鍵安裝並在失敗時獲得結構化診斷，作者能回答「多少人裝成功、失敗在哪裡、目前跑哪個版本」。

現在做的理由：技能作者每天被安裝問題打斷 3–5 次，直接延誤研發效能基礎設施本職工作；同時公司缺少任何採用基線，無法證明一次推廣是否形成真實採用。

---

## 2. Background & Context

### 現狀鏈路

```text
作者／公共架構建立或選擇技能 → 分享會介紹 → Wiki + 安裝檔案 + 即時通訊連結
  → 員工逐人閱讀、安裝、配置、調試 → 依賴／環境／版本失敗
  → 群聊詢問作者 → 作者重複解答或遠程協助 → 無統一成功記錄、版本分布或反饋閉環
```

真正的競爭者不是另一個技能商城，而是「Wiki＋Git＋群聊＋作者人工支援」。

### 已觀察到的需求證據

- 幾乎大部分接受宣講的員工都會嘗試安裝相關技能。
- 技能作者一天被打斷 3–5 次，每次支援從數分鐘到半小時。
- 最常見失敗集中在依賴、環境、版本三類。
- 部分員工因開源工作流耗時，自建輕量版技能並在即時通訊小範圍傳播。
- 多團隊同時在推廣：公共架構（`superpowers`、Git worktree 流程、SDD／TDD）、DBA（MySQL MCP）、產品（`pm-skill`）、後端（`gsd-core`）。

### 尚未建立的基線（Pilot 0 的存在理由）

每個技能的安裝人數、首次成功運行時間、求助率、作者總支援時間、各版本活躍分布——全部未知。因此不能只交付瀏覽頁面：**第一階段必須同時交付安裝能力與採用可觀測性**。

### 業界對照結論

Open Agent Skills 定義了 `SKILL.md` 技能格式；Backstage 驗證「元數據跟隨 Git、平台負責索引與發現」；GitHub Copilot Plugins 把 Skills／Agents／Hooks／MCP 組合成版本化插件；GitHub Enterprise MCP 採 Registry＋Allowlist＋客戶端執行。

> 平台不應成為新的包格式或 Git 替代品，而應成為公司內部的信任、策略、安裝編排與採用可觀測控制面。

---

## 3. Objectives & Success Metrics

### Goals

1. **降低作者中斷**：試點作者被安裝問題打斷從每日 3–5 次降到每日 ≤1 次。
2. **建立可靠安裝**：從安裝意圖到本機驗證的成功率 ≥90%，首次可運行時間中位數 <5 分鐘。
3. **建立採用基線**：作者能看見安裝成功率、失敗分類、活躍版本分布與待升級使用者。
4. **建立可治理交付**：100% 安裝結果具備終態，100% 失敗具備結構化錯誤碼且不含憑證／提示／業務代碼。
5. **保留擴展邊界**：Schema、Adapter、Event 支援 Skill／Plugin／MCP／Bundle 與後續治理能力，但不實現其頁面與工作流。

### Non-Goals（明確不做，及理由）

1. **不建立新的 Agent Skill／Plugin／MCP 打包標準** — Git 與開放 Manifest 保持內容真實來源，平台只加一層公司 Manifest。
2. **不把技能二進制或源碼複製進平台數據庫** — 避免平台變成 Git 替代品。
3. **不實現社交動態流、關注關係、聲望體系、點讚踩與完整評論** — 第一階段的價值來自交付可靠性，不是社區熱度。
4. **不根據點讚數自動提升技能等級** — 推廣必須依賴質量門檻、風險審核與真實採用數據。
5. **不在缺少安全審批與回滾前強制安裝公司級技能** — 強制推廣無回滾會大範圍破壞開發環境。
6. **不將公司憑證、Token 或密鑰寫入技能包** — Manifest 只聲明憑證類型，運行時向企業憑證系統取得。
7. **不拆分為多個獨立微服務** — 採用模式未知時提前承擔分散式一致性與運維成本，會延遲 MVP。
8. **不承諾支援所有 Agent 客戶端與作業系統** — Pilot 1 只做 Pilot 0 選定的單一 Client × 單一 OS。
9. **不支援 Bundle 安裝、通用 MCP 沙箱、未知 MCP 靜態掃描、IM Bot、IDE 原生界面** — 全部 Deferred。
10. **不開放頭部與底部模組給維護者** — 維護者只能填寫中間部（安裝）與卸載部；uid 取得與遙測上報邏輯由平台生成且不可覆寫。<br>*（原條目為「不執行任意 Shell 腳本 — InstallPlan 只能使用平台審核過的操作原語」。**該原語模型已於 2026-08-12 被三段式腳本模型取代**，理由見 § 一鍵安裝腳本模型。安全邊界改由發布前審核＋簽名＋演示環境驗證承擔。）*

### Success Metrics

Pilot 1 在兩週內提供方向性信號；**累積至少 50 次獨立安裝嘗試後**才做推廣 Gate。10–20 人樣本只能產生方向性信號，不能證明跨公司普遍效果。

| # | Metric | Current | Target | Measurement |
|---|---|---|---|---|
| M1 | 意圖到本機驗證成功率 | 未知（Pilot 0 建立） | ≥90% | `succeeded` 獨立嘗試 ÷ 所有建立安裝意圖的獨立嘗試；報告分子、分母與 Wilson 95% CI。**驗收條件包含 D2／D4**——平台側故障期的嘗試須可標記並排除，未實作即視為 M1 未完成，不得記為「M1 完成、D4 待辦」 |
| M2 | 合格預檢後執行成功率 | 未知 | 觀測項，非唯一 Gate | `succeeded` ÷ 進入 `installing` 的獨立嘗試 |
| M3 | 首次可運行時間（中位數） | 未知 | <5 分鐘 | **雙口徑並列報告**：平台口徑＝腳本開始執行 → 底部上報成功；員工口徑＝下載腳本 → 上報成功（含閱讀說明、確認、執行等待）。目標值適用平台口徑；員工口徑為可信度校驗，不得只報前者 |
| M4 | 需要作者人工協助比例 | 未知 | <10% | 使用者提交「需要協助」、作者建立支援記錄、或觀察員記錄人工介入，任一即 true |
| M5 | 作者每日被中斷次數 | 3–5 次／日 | ≤1 次／日 | Owner 記錄的非計劃同步支援接觸；同一使用者同一問題 30 分鐘內合併 |
| M6 | 安裝結果終態覆蓋率 | 0%（無記錄） | 100% | 成功／失敗／回滾終態；缺終態超過 24 小時列為 `unknown`，單獨展示不得排除 |
| M7 | 失敗結構化錯誤碼覆蓋率 | 0% | 100% | 每個失敗落入可操作錯誤分類，且不含憑證、提示、業務代碼 |
| M8 | 版本分布可見性 | 不可見 | 可見 | 由腳本上報的安裝成功事件推導當前版本分布，扣除已上報卸載者。**不再依賴 Client Usage Ping**——A0 證明該路徑在所有候選客戶端上不成立 |
| M8b | 下載到安裝轉化率 | 未知 | 觀測項 | `InstallationSucceeded` ÷ `ScriptDownloaded`。低轉化率代表腳本本身或前置說明有問題，是比成功率更早的預警信號 |
| M8c | 卸載率 | 未知 | 觀測項 | `PackageUninstalled` ÷ 累計安裝成功數。**原設計完全缺失的流失測量**，比版本分布更能說明技能是否真的有用 |
| M9 | 緊急禁用生效範圍 | 不具備 | 見右 | **不承諾時間 SLO。** 平台能力上限為：撤下腳本下載即時生效（阻止新安裝）；已安裝實例不具備遠端停用能力。<br>**改寫依據**：A0 證明五個候選客戶端均無週期性 Check-in，且 managed settings 下發路徑已明確不採用。原「10 分鐘確認」在任何候選上都不成立 |

**降級條款**：若 Pilot 0 無法取得可靠基線，M4／M5 改為相對改善 ≥70%，但計算方式必須在試點前固定。

**硬合同**：Metric Contract（獨立安裝嘗試、成功率、首次可運行時間、人工協助、活躍安裝、待升級、作者中斷的精確定義）必須在 Pilot 0 結束前凍結，見設計檔 § Metric Contract。

**指標歸屬聲明（Phase A 啟動前須共識）**：

- **M1／M2／M3／M6／M7** 衡量**平台可靠性**，不依賴任何外部條件，項目負完全責任。
- **M8／M8b／M8c** 衡量**採用與流失**，腳本模型下不再依賴 Client 能力，項目負完全責任。
- **M9** 不是達成型指標，而是**能力聲明**——平台須如實說明「撤下下載即時生效、已安裝實例無遠端停用」，項目負「不誇大」的責任。
- **M4／M5** 衡量**作者中斷改善**，其達成同時取決於中斷的真實構成（見 A1b）、組織推廣節奏與員工習慣遷移速度——項目負部分責任。

> 因此：**若 M1／M2／M3／M6／M7 全部達標而 M5 未達標，Pilot 1 不得判定為失敗。** 正確處理是按 A1b 的四類分布重新檢視 M5 目標值是否從一開始就設錯，並把使用類中斷轉入 Phase D／F 範圍。此判定口徑須在 Phase A 啟動前與 stakeholder 取得共識，不得留到結果出來後再議。

---

## 4. Target Users & Segments

### 核心使用者（Pilot 1 唯一優化對象）

**公共架構技術賦能工程師** — 負責推廣 `superpowers` 等技能。本職是建設研發效能基礎設施，但每天被安裝問題打斷 3–5 次。

需要：可重複發布與升級技能、安裝前發現依賴／環境／版本／權限問題、常見問題自動修復或產生可執行診斷、看見誰成功／失敗在哪／哪些版本仍在用、必要時下架禁用回滾。

### 次要使用者

| 段別 | 描述 | Pilot 1 涉入 |
|---|---|---|
| 技能消費員工 | 產品、前端、後端、DBA、公共架構員工 | Pilot 1 招募 10–20 名，跨這四類團隊 |
| 內部技能作者 | 上架自定義技能者 | Pilot 1 僅單一作者（`superpowers` Owner）；多作者上架延後 |
| 管理員 | 審批、公司級推廣、安全、開源發布 | Pilot 1 僅單人審批 + 審計 + 緊急禁用 |

### 分段規模

Pilot 0 必須量測：公司主要 Agent 客戶端及版本分布、macOS／Linux／Windows 員工比例。這兩項直接決定 Pilot 1 的 Support Matrix。

---

## 5. User Stories & Requirements

### P0 — Must Have

#### Phase A：Pilot 0 基線建立（不寫平台代碼）

| # | User Story | Acceptance Criteria |
|---|---|---|
| A0 | 作為 Owner，我要先確認候選 Client 具備兜底能力，再選定 Client | **在 Q1 決策前**查證候選 Client 的插件 API 文檔，確認是否提供 (a) 簽名 Check-in 或等價生命週期 hook、(b) Plugin 載入 Usage Ping、(c) 可驗證的 Plugin 停用接口。<br>**已於 2026-08-12 完成**，結果見 [a0-client-capability-matrix.md](./a0-client-capability-matrix.md)。查證範圍：Claude Code、Codex、GitHub Copilot、Gemini、Cursor |
| A0d | 作為 Owner，我要確認 `superpowers` 的當前 Client 支援範圍 | 讀取 `superpowers` 上游倉庫，列出其 `official` 適配的 Client 清單。**Pilot 1 的 Client 必須落在此範圍 ∩ A0 通過名單**；交集為空時，須先由公共架構實現 `internal` 適配（標記來源與維護者），或更換試點 Package |
| A0b | 作為 Owner，我要在 Phase A 啟動時就送出隱私審核 | 送審材料為 § 遙測字段白名單（OS 類型、使用者標識、Package ID 與 Version、安裝狀態、卸載狀態、時間）＋ **UUID 的生成方式、持久化位置與保留期**。**此項與 Pilot 0 觀察並行，不等 Pilot 1 設計完成**——隱私審核是跨部門流程，週期不可控，若拖到 Phase C 才啟動，Goal 3 與 C13a／C13b 會當期失效 |
| A0c | 作為公共架構負責人，我要指定 Gate 裁決人 | 指定兩名共簽人（建議：Owner ＋ 一名非項目成員的技術負責人），姓名寫入本 PRD。**Phase A／B Exit Gate 的通過與繞過均須兩人共簽並留書面記錄**；繞過必須是顯式決策，不得為默認滑過 |
| A1 | 作為 Owner，我要在不改變現有流程下觀察一輪 `superpowers` 推廣，取得真實基線 | 記錄嘗試安裝人數、成功人數、首次成功運行時間、Owner 被打斷次數與支援時間、OS／Client／版本分布；員工自行使用現有材料，觀察員不在旁指導。**每次中斷必須分類為「安裝／使用／價值／其他」四類之一**（安裝＝裝不上；使用＝裝好但不知怎麼用；價值＝用了但不符預期；其他）|
| A1b | 作為 Owner，我要知道 M5 目標值在數學上是否可達 | 由 A1 的四類分布計算安裝類佔比。安裝類 <60% 時，M5（≤1 次／日）不可達，必須在 Pilot 1 啟動前重算目標值或改用相對改善口徑；使用類佔比顯著時，列為 Phase D／F 的產品線索（詳情頁需嵌入使用引導，而非僅安裝說明）|
| A1c | 作為 stakeholder，我要知道基線數據的觀察者限制 | Owner 同時是試點對象、數據記錄者與項目推動者，存在結構性觀察者效應（知道自己在記錄中斷，本身會改變處理中斷的方式）。Metric Contract 的合併規則（同一使用者同一問題 30 分鐘內合併）降低了隨意性但未消除此限制。<br>**須在 Phase A 啟動前決定**：接受此限制並在報告中明示，或指派一名非項目成員做交叉記錄（成本約每日一次五分鐘確認）|
| A2 | 作為 Owner，我要凍結 Metric Contract | 設計檔 § Metric Contract 的 8 項定義全部落定並經 stakeholder 簽署；Pilot 1 啟動前不得變更 |
| A3 | 作為 Owner，我要輸出 Pilot 1 的可交付合同 | Support Matrix 的 Package Version / Client / Client Version / OS / OS Version / Adapter ID+Version / Artifact Digest 全部以實值取代 `TBD`；Client 必須通過 A0 篩選 |
| A4 | 作為 Owner，我要收集現有材料與最常見問題 | 現有 Wiki、安裝檔案與 Top 10 問題成文，作為預檢規則的輸入 |
| A4b | 作為 Owner，我要知道 `superpowers` 是否為典型樣本 | 取得 `pm-skill` 與 `gsd-core` 作者同期一週的支援負擔（每技能每週小時數）作為對照組。若 `superpowers` 低於對照組 50% 以上，表示它是容易樣本——Adapter 接口必須按對照組的複雜度設計，避免第二個技能上來時返工。**此項不阻塞 Phase A 啟動，可並行推進**。<br>**保底降級**：若無法取得完整一週記錄，改為對兩位作者各做 30 分鐘訪談，取得「最花時間的三類支援問題」定性結論——定性數據已足以校準 Adapter 複雜度假設，不得因拿不到量化數據而整項略過 |
| A5 | 作為 Owner，我要重估 Pilot 1 工期 | 產出支持矩陣、試點樣本計劃、集成依賴、負責人、可驗收工作包；SSO／Git／分發／本機執行權限未就緒時，不沿用 7–10 週概念估算 |

**Phase A Exit Gate**：Support Matrix 含任一 `TBD` 時，不得估算或開始 Pilot 1。選定的 Client 必須通過 A0 的三項兜底能力篩選；若所有候選 Client 均不通過，見 § Degraded Mode 的降級聲明要求。

> **Gate 裁決規則（適用 Phase A 與 Phase B）**：由 A0c 指定的兩名共簽人裁決。Gate 通過需書面確認；Gate 未通過而選擇繼續，須以「顯式繞過決策」形式記錄理由、承擔的風險與補償措施——**默認滑過不構成有效決策**。此規則的存在理由：硬約束只有在有人負責執行時才是硬的。

#### Phase B：Technical Spike Gate（Pilot 1 開發前）

| # | User Story | Acceptance Criteria |
|---|---|---|
| B1 | 作為工程師，我要證明四段式腳本能完成真實安裝 | 把現有 `superpowers` 人工安裝步驟填入中間部，與平台生成的頭部／底部組合後，在乾淨環境完成安裝並成功上報。**同時填寫卸載部並驗證卸載可執行** |
| B1b | 作為 Gate 裁決人，我要有明確規則決定 B1 失敗時怎麼辦 | **處置閾值（Spike 啟動前生效，不得臨場調整）**：<br>• 1–2 個「必須人工介入且無替代」的步驟 → 移出腳本，在下載頁明示為手動步驟，Pilot 1 繼續<br>• ≥3 個此類步驟，**或**任一步驟涉及權限授予／憑證配置 → 停止 Pilot 1，回到 Phase A 重選試點技能<br>• **卸載命令無法覆蓋安裝副作用** → 依 Q0f 決議：聲明 `has_residual_effects=true` 並填寫殘留說明與手動清理步驟；腳本卸載前提示使用者。**不得靜默發布**<br>三選一（縮小範圍／降低承諾／停止）的決策須由 A0c 指定的兩名共簽人書面裁決 |
| B1c | 作為安全負責人，我要確認腳本模型的安全邊界真的守得住 | 腳本模型放棄原語管控後，安全依賴發布前審核。須實測：<br>• 惡意中間部命令能否通過審核流程（紅隊測試至少 3 種攻擊樣本）<br>• 簽名與摘要驗證能否阻止下載後篡改<br>• 頭部 uid 取得與底部上報能否被中間部命令繞過或停用<br>**第三項若失敗，整個遙測模型不成立，M1／M8 全部失效** |
| B2 | 作為工程師，我要證明 Artifact 可簽名不可變 | 從 Git commit 產生簽名不可變 Artifact，並以摘要（非可變 Git Tag）安裝 |
| B3 | 作為工程師，我要證明全生命週期在乾淨環境可行 | 安裝、驗證、升級、卸載、回滾五個動作在乾淨環境全部通過 |
| B4 | 作為工程師，我要證明**客戶端側**故障可恢復 | 在每個步驟注入斷線、權限不足、磁盤不足、內容被使用者修改、進程中止五類故障，均能恢復到最後可證明步驟 |
| B4b | 作為工程師，我要證明**平台側**故障有明確路徑 | 注入三類平台側故障：Portal／API 不可用、Artifact Registry 不可用、Policy 引擎不可用。每類都必須產生明確的使用者可見狀態與下一步指引，不得表現為無限等待、靜默失敗或誤導性錯誤 |
| B4c | 作為工程師，我要實測平台不可用時的上報補交 | 腳本模型下安裝本身不依賴平台（D1 天然成立），但**底部上報會失敗**。須實測：上報失敗時寫入本機隊列、恢復連線後補交、服務端依冪等鍵去重、以及使用者在上報失敗時看到的狀態是否明確（不得讓安裝成功但上報失敗看起來像安裝失敗）|
| B5 | 作為工程師，我要證明不覆蓋使用者修改 | Managed Resource Ownership 與 Baseline／Managed／Current 三方合併驗證通過；無法安全合併時進入 `local_conflict` 且不覆蓋不刪除 |
| B6 | 作為工程師，我要證明禁用能力真實存在 | 證明選定 Client 的 Plugin 停用方式、Check-in 傳輸機制、禁用生效時點；在最近 Check-in 的安裝上量測 Revocation 傳播／接收／套用／回執延遲 |

**Phase B Exit Gate**：四段式腳本能完成安裝與卸載（B1）+ 安全邊界實測通過，特別是頭部／底部不可被中間部繞過（B1c）+ Support Matrix 無 `TBD` + 禁用能力上限已按 A0 結論如實聲明 + B4c 的 D1 實測結論已落回 PRD。否則按 B1b 閾值裁決，適用上方 Gate 裁決規則。

#### Phase C：Pilot 1 閉環安裝

| # | User Story | Acceptance Criteria |
|---|---|---|
| C1 | 作為員工，我要用 SSO 登入並被正確識別團隊 | SSO 身份與團隊／角色映射生效；無 SSO 時只能做隔離技術演示，不進入員工試點 |
| C2 | 作為員工，我要在技能池搜尋並查看 `superpowers` 詳情 | 詳情頁按序展示：用途與所有者 → 信任層級與推廣狀態 → 與當前環境相容性 → 權限與憑證需求 → 安裝成功率／首次運行時間／版本採用 → 評價與討論（第一階段僅結構化使用反饋）|
| C3 | 作為員工，我要在安裝前知道我的環境是否能跑 | 預檢覆蓋環境、依賴、版本、權限四類；阻塞時進入 `preflight_blocked` 並給出可操作原因，不進入安裝 |
| C4 | 作為員工，我要在執行前看見腳本會做什麼 | 下載頁與腳本首部展示：將執行的安裝命令全文、影響的資源、所需權限、**以及本腳本會上報哪些遙測字段**。UserConsent 綁定腳本摘要；腳本內容變更後須重新確認 |
| C5 | 作為員工，我要下載一鍵安裝腳本並完成安裝 | 平台按使用者系統組合四段模組、簽名後提供下載 → 本機執行 → 頭部取得 uid → 中間部安裝 → 底部上報成功／失敗與結構化錯誤碼 → API 聚合終態 |
| C5b | 作為員工，我要用同一腳本卸載，並事先知道清不乾淨的部分 | 腳本具備卸載能力，執行維護者填寫的卸載命令並上報 `PackageUninstalled`。<br>**若 `has_residual_effects=true`，須在執行卸載動作前**展示殘留說明與手動清理步驟，取得確認後才繼續——不得在卸載完成後才告知 |
| C5c | 作為平台，我要記錄下載作為興趣信號 | 每次下載產生 `ScriptDownloaded` 事件，含 uid（未登入為退化標識）、PackageVersion、目標系統、時間 |
| C5d | 作為維護者，我要在頁面填寫安裝與卸載命令 | 提供中間部與卸載部的填寫入口；**須選擇適用系統（macos／linux／windows／wsl）**；**須聲明 `has_residual_effects`，為 true 時填寫殘留說明與手動清理步驟**。提交後進入 `review_required`，審核通過才組合簽名並上線。頭部與底部不對維護者開放 |
| C6 | 作為員工，我要在失敗時取得結構化診斷 | 每個失敗落入可操作錯誤分類；不含憑證、提示內容、業務代碼、完整環境變數 |
| C7 | 作為員工，我要安全升級、卸載與回滾 | 安裝到暫存位置、驗證成功後原子切換；保留上一可用版本與回滾資料；升級新增權限時重新取得同意或審批 |
| C8 | 作為員工，我要在本機有自定義時不被覆蓋 | 資源等於 Managed Digest 時執行原定補償；被修改時三方合併；無法合併進入 `local_conflict` 並展示差異停止；平台只刪除自己建立且未被修改的資源 |
| C9 | 作為員工，我要在斷線後不重複安裝 | 事件寫入本機加密隊列，恢復後按序提交；服務端依步驟序號去重；本機完成未確認時顯示 `result_pending_sync`，不判為失敗 |
| C10 | 作為員工，我要查看我的安裝與待升級版本 | 「我的安裝」頁列出當前版本、狀態、可升級版本 |
| C11a | 作為管理員，我要手工導入單一簽名版本並發布 | 導入指定 commit 產生的簽名 Artifact，驗證摘要與 Manifest Schema，經一次 `PublicationReview` 批准後發布至 Catalog。**Pilot 1 單 Package 單作者場景下手工導入已足夠**，見硬阻塞表「Git/CI 自動同步」條目 |
| C12 | 作為作者，我要管理版本生命週期 | 支援 `draft → validating → review_required → published → deprecated → delisted`，及 `emergency_disabled` 覆蓋；`validation_failed → draft`；下架不等於刪除，審計與歷史安裝記錄保留 |
| C12b | 作為平台，我要確保未審核版本不被任何人看見 | **發布動作不等於上線。** 作者提交發布後版本進入 `review_required`（待審核），**此狀態下不出現在技能池、搜尋結果與任何下載入口**，僅作者本人與指定審核者可見。審核通過轉 `published` 後才對員工展示。<br>拒絕時回到 `draft` 並附理由；作者修改後須重新進入審核，**不得沿用前次審核結果** |
| C13a | 作為作者，我要看見失敗在哪裡 | 分析頁展示成功率（含 Wilson 95% CI）、失敗原因分布（按 Version／OS／Client）、首次運行時間（雙口徑）、求助率。**僅依賴 Installation 終態，不依賴 Client 能力——無條件 P0** |
| C13b | 作為作者，我要看見誰在跑哪個版本、誰卸載了 | 版本分布（由安裝成功事件推導，扣除已卸載）、待升級使用者清單、下載到安裝轉化率、卸載率。**已轉為無條件 P0**——腳本模型的遙測不依賴 Client 能力，原「條件式」前提消失 |
| C14a | 作為審核者，我要按標準審核待發布版本 | `PublicationReview` 單人審批：`pending → approved｜rejected`；審批理由與操作者進入審計。審核依 § 發布審核標準執行——**兩項均通過才可 approve**。<br>**資料模型仍按 `PublicationReview`／`InstallationApproval`／`UserConsent` 三對象分離設計（架構決策不可省），但 Pilot 1 只實現 `PublicationReview` 的執行路徑** |
| C14c | 作為審核者，我要在演示環境實測後再決定 | 平台提供乾淨環境供審核者實際執行待審腳本，驗證安裝成功、遙測字段如實上報、卸載可執行。**審核不得僅憑閱讀命令文本完成** |
| C14b | 作為平台管理員，我要指定誰有審核權 | 審核者由平台管理員指定，可按 Package 類型、分類或全域授權；**作者不得審核自己提交的版本**。指定與撤銷審核權進入審計。Pilot 1 支援單人審核，資料模型保留 `approval_group`／`required_count` |
| C15a | 作為管理員，我要阻止有風險版本被繼續安裝 | 撤下該 PackageVersion 的腳本下載入口，即時生效；記錄 reason_code、effective_at、操作者並進審計。**此為止血能力，即時且可驗證** |
| C15b | 作為管理員，我要通知已安裝的使用者 | 平台無遠端停用能力（A0 已證明，且 managed settings 路徑不採用），故改為：依安裝上報記錄定位受影響 uid，透過公司通知渠道發出卸載或升級指引，並提供一鍵卸載腳本。**平台須如實聲明「通知」不等於「停用」**，不得以措辭暗示具備強制能力 |
| C16 | 作為安全負責人，我要確保遙測不越界 | 只收集 § 遙測字段白名單所列字段：OS 系統類型、使用者標識（uid 或 UUID）、Package ID 與 Version、安裝成功／失敗狀態、卸載狀態、各狀態時間。新增字段須重新通過隱私審核；日誌預設脫敏。**白名單同時是 C14a 標準一的判斷依據** |
| C18 | 作為員工，我要在升級前看見權限與資源差異 | 展示本機當前狀態與目標狀態的**權限新增項**與**受管資源差異**。**此為 C7／C8 的依賴而非獨立增強**——C7 要求「新增權限時重新取得同意」、C8 要求「衝突時展示差異並停止」，兩者都預設差異展示能力存在。升級前的完整安裝預覽仍留 P1（S2）|

**Phase C Definition of Done（適用每一條 story，非獨立工作項）**

- 所有頁面定義 Loading、Empty、Error、Partial、Success 五種狀態。*（原 C17。它是每條前端 story 的完成定義，不是可獨立排期的任務——列為獨立 story 會導致要麼被誤排成單一任務，要麼被推遲到「最後統一處理」。）*
- 所有失敗路徑產生結構化錯誤碼，且不含憑證、提示內容、業務代碼、完整環境變數。
- 所有有副作用的操作使用冪等鍵。

**條件式 P0 規則已失效（2026-08-12）**

原決策表按 Q0 結果決定 C13b／C15b／M8／M9 的納入與否。**A0 完成 + 腳本模型採用後，此表不再適用**：

- **C13b、M8 轉為無條件 P0** — 遙測改由腳本上報，不依賴 Client 能力
- **C15b 改變性質** — 從「停用已安裝」改為「通知已安裝使用者」，因平台確無遠端停用能力
- **M9 取消時間 SLO** — 改為聲明能力範圍而非承諾時限

保留的原則：**能力上限須如實聲明，不得以措辭暗示平台具備實際不存在的管控力。**

**Phase C 硬阻塞（缺一不得發布）**

| 缺失項 | 後果 |
|---|---|
| 簽名 Artifact Registry | 不得發布可安裝版本 |
| 可靠 CLI 分發與自更新 | 不得宣稱緊急禁用 SLO |
| SSO | 只能做隔離技術演示，不進入員工試點 |
| 設備身份（MDM 證明） | 只允許使用者綁定的低風險 Plugin 操作；不得使用「受管設備」措辭或宣稱設備級管控 |
| 結構化預檢與回滾 | 不得開放自助安裝 |
| 隱私批准的事件 Schema | 只保留本機診斷，不上報採用分析 |
| Git/CI 自動同步 | **非 Pilot 1 阻塞項**——C11a 手工導入單一簽名版本即可交付；自動同步為 S6，多作者上架前才需要 |
| 頭部／底部模組可被中間部繞過（B1c 第三項失敗）| **整個遙測模型不成立**，M1／M8／M8b／M8c 全部失效。此時須停止 Pilot 1 並重新設計上報機制，不得帶著不可信的遙測發布 |
| 腳本簽名與摘要驗證缺失 | 不得開放腳本下載——使用者無法確認下載內容未被篡改 |

#### Degraded Mode：平台自身不可用時的路徑

現有設計已完整處理**安裝失敗**的兜底（預檢、回滾、`local_conflict`、三方合併、`result_pending_sync`、斷線隊列），但未處理**平台自身不可用**。此節補齊。

平台是逐步推廣、逐步過渡的交付路徑，群聊與諮詢作者始終保留為員工可選路徑——因此 Degraded Mode 的目標不是「保證員工永遠能透過平台完成安裝」，而是**保證員工在任何時刻都知道自己處於什麼狀態、下一步該做什麼**。靜默失敗與誤導性狀態比明確的「暫時不可用，請走這條路」傷害更大。

| # | User Story | Acceptance Criteria |
|---|---|---|
| D1 | 作為員工，我要在 Portal 不可用時仍能完成已下載的安裝 | **腳本模型下此路徑天然成立**——腳本已在本機，中間部安裝命令不依賴平台。底部上報失敗時寫入本機隊列，恢復連線後補交；安裝本身不受影響。<br>*（原設計依賴 CLI 快取 InstallPlan＋短期 Token＋即時 Policy 評估，pre-mortem T3 曾標記此路徑可能不成立。腳本模型消除了該風險。）* |
| D2 | 作為員工，我要在 Artifact Registry 不可用時取得明確狀態 | 進入 `preflight_blocked` 並標記原因為平台側；**不計入 M1／M2 的失敗分母**，單獨列為平台可用性事件 |
| D3 | 作為員工，我要在平台完全不可用時有明確出口 | Portal 與 CLI 均提供「取得手動安裝指引」出口，連向該 PackageVersion 對應的 Wiki／README；此出口為明確降級路徑，不隱藏 |
| D4 | 作為 Owner，我要區分平台故障與技能故障 | 平台側不可用期間的安裝嘗試單獨標記，不污染成功率統計；Owner 分析頁可切換「含／不含平台故障期」視圖 |
| D5 | 作為管理員，我要在無遠端停用能力下仍有止血手段 | **A0 已確認：五個候選 Client 均無此能力，且 managed settings 路徑不採用。** 平台能力上限固定為：撤下下載即時阻止新安裝＋依上報記錄通知受影響 uid＋提供一鍵卸載腳本。此限制寫入 PRD 與對外說明，**不得以任何措辭暗示具備強制停用能力**；替代兜底為更嚴格的發布前審核與分批放量（範圍與觀察窗口須在 Phase A 定義）|

**Degraded Mode 的邊界**：平台不承諾在自身不可用時仍能完成全部安裝流程。它承諾的是——每一種不可用都有可見狀態、有分類、有下一步，且不污染指標。

### P1 — Should Have

僅在 P0 達到 Pilot 成功標準後進入，**不與 Pilot 1 並行承諾**。

| # | User Story | Acceptance Criteria | 來源 |
|---|---|---|---|
| S1 | 作為員工，我要在第二個高頻 Agent 客戶端或 Windows 上安裝 | 新增 Adapter，不修改 Catalog 或 Governance | 原 P1 |
| S2 | 作為員工，我要在安裝前看見完整預覽 | 升級前的完整安裝預覽（超出 C18 已涵蓋的權限與資源差異部分）| 原 P1，**核心部分已升為 C18** |
| S3 | 作為作者，我要配置支援入口 | 詳情頁展示 Owner 指定的支援渠道 | 原 P1 |
| S4 | 作為員工，我要提交結構化使用反饋 | `POST /feedback/usage`；含「需要人工協助」標記 | 原 P1 |
| S5 | 作為員工，我要收到公司推廣的推薦更新通知 | 僅推薦，不含默認安裝或強制安裝 | 原 P1 |
| S6 | 作為作者，我要用 Git PR 觸發自動發布管線 | Manifest Schema 驗證 → 格式與依賴檢查 → 安全掃描 → Adapter Dry Run → 審批 → 簽名不可變快照＋SBOM＋摘要 → Artifact Registry → Catalog 發布 | **原 C11 降級**。Pilot 1 單 Package 單作者用 C11a 手工導入已足夠；自動化管線的價值在多作者場景，屬 Expansion 前置 |
| S7 | 作為管理員，我要批准特權安裝 | `InstallationApproval` 完整狀態機：`pending → approved｜rejected｜expired｜cancelled`，`approved → revoked`；審批有效期、冪等鍵、角色解析 | **原 C14 拆出降級**。Pilot 1 只允許低風險試點原語，`InstallationApproval` 不會被觸發——實現一個當期不會執行的流程是無效工作量。資料模型的三對象分離仍在 C14a 保留 |

### P2 — Nice to Have / Future（Deferred）

| # | 能力 | 前置條件 |
|---|---|---|
| F1 | 點讚踩、完整評論與討論 | 評分綁定已驗證安裝與具體版本的策略確定（Open Question Q8）|
| F2 | 精品池、通用標準池與自動晉升 | 信任金字塔六層全開；質量門檻與風險審核成文 |
| F3 | 公司級默認安裝或強制安裝 | 分批推廣、延期窗口、例外機制、回滾演練齊備（Open Question Q6）|
| F4 | Pilot 2：MySQL MCP | 需 DBA 預批准的單一 MCP、固定版本、固定啟動方式、只讀資料庫角色、最小權限模板、受管 Process Supervisor |
| F5 | Bundle 依賴解析與原子安裝 | Lockfile 生成與傳遞依賴解析落地；另立里程碑 |
| F6 | 通用 MCP 沙箱與未知 MCP 靜態掃描 | 另立里程碑 |
| F7 | IM Bot、IDE 原生頁面、多入口編排 | Pilot 1 只交付 Web Portal ＋ CLI |
| F8 | 外部開源導出（`OpenSourceExport`）| Secrets／License／Dependency Gate ＋ 公共架構與法務審批 |
| F9 | 多服務拆分 | 吞吐、隔離或團隊所有權出現證據時才拆 |
| F10 | 複雜推薦算法 | — |
| F11 | **內部／社群 Client 適配的上架、審核與信任升級流程** | Manifest schema 已於 Pilot 1 預留 `adaptation_source`／`adaptation_maintainer`／`adaptation_verified_at`；本項為其工作流實現——適配提交、驗證標準、維護者歸屬、信任層級升降、上游變更時的適配失效處理 |
| F12 | P2 層 Client Adapter（Cursor、Antigravity CLI、OpenCode、Pi 等）| 依實際採用分布排序；每個新 Client 只新增 Adapter，不改 Catalog 或 Governance |
| F13 | **審核的規模化：時效要求、積壓處理、輔助自動化** | Pilot 1 的純人工、無時效審核僅適用於單 Package 單作者。多作者上架前須解決：審核 SLA、積壓可見性、審核者輪值或分工、以及**輔助**自動掃描（先過機器再過人，不取代人工決策）。<br>這是腳本模型的結構性代價——原「Git PR 自動化管線」（S6）能繞過的瓶頸，人工審核把它拉了回來 |

---

## 6. Solution Overview

### 選定方案：Approach B — 模組化技能交付控制面

已評估三案：A（GitOps 目錄，最快但治理加入時需重建服務端模型）、B（模組化單體）、C（完整事件驅動平台，提前承擔分散式成本）。選 B：第一階段完成交付閉環，後續能力沿既有邊界擴展。

### 系統形態

```text
┌───────────────────────────────────────────────┐
│ Web Portal │ CLI / Local Executor │ IDE Adapter│
└───────────────────────┬───────────────────────┘
┌───────────────────────▼───────────────────────┐
│              Modular Platform API             │
├──────────┬───────────┬──────────┬─────────────┤
│ Catalog  │ Installer │Governance│ Feedback    │
│ Versions │ Adapters  │ Policy   │ Discussion  │
├──────────┴───────────┼──────────┴─────────────┤
│ Analytics / Audit    │ Identity / Permissions │
└──────────────────────┬────────────────────────┘
┌──────────────────────▼────────────────────────┐
│ Git │ CI │ Agent Clients │ Secret Manager     │
└───────────────────────────────────────────────┘
```

單一部署單元＋單一關聯資料庫。模組禁止直接修改其他模組的表；跨模組操作透過應用服務與領域事件完成，事件使用同庫 Outbox，不引入外部消息中間件。

### 關鍵設計決策

| 決策 | 理由 |
|---|---|
| **控制面／本機執行分離** | 平台 API 不直接操作員工電腦；CLI 內含 Local Executor 執行預檢、安裝、驗證、卸載、回滾。本機文件內容、完整環境變數、業務代碼、長期憑證不離開設備 |
| **Git 是內容真實來源** | 平台索引、驗證、治理，不吞掉原有工程工作流，不複製源碼進資料庫 |
| **三段式一鍵安裝腳本（取代原語模型）** | 平台生成頭部／底部，維護者填寫中間部與卸載部。遙測錨點在腳本自身，不依賴 Client hook 能力——此決策直接來自 A0 查證結論（五個候選客戶端均無週期性 Check-in）。詳見 § 一鍵安裝腳本模型 |
| **內容與發布狀態分離** | `PackageVersionContent` 不可變（由 Package ID＋Version＋Artifact Digest＋Manifest Digest＋Source Commit 唯一確定）；`ReleaseStateEvent` 追加式記錄，當前狀態由事件折疊得出 |
| **三種審批對象不共用** | `PublicationReview`（版本上架）、`InstallationApproval`（特權安裝批准）、`UserConsent`（員工對本次計畫的確認，不代表管理審批）|
| **憑證只被引用不被打包** | Manifest 聲明憑證類型，運行時向企業 Secret Manager 取得短期憑證 |
| **Manifest 加一層不替代原格式** | `apiVersion: agent-platform.company/v1alpha1`，版本化 Schema，新增字段向後相容，破壞性變更用新 `apiVersion` ＋ 自動遷移工具 |
| **Adapter 穩定接口** | `detect / preflight / plan / install / verify / upgrade / uninstall / rollback`；新客戶端只加 Adapter，不改 Catalog 或 Governance |
| **失敗關閉策略分級** | Registry／Policy 不可用時，受管高風險工具失敗關閉；已安裝低風險純文本 Skill 可離線續跑最多 24 小時。高風險 MCP 禁用快取 TTL 上限 30 分鐘 |

### 一鍵安裝腳本模型（Pilot 1 核心交付機制）

**架構決策**：放棄「InstallPlan 原語 Allowlist」，改採平台生成的三段式安裝腳本。

**決策依據**：A0 查證證明五個候選客戶端均不提供週期性簽名 Check-in，因此**任何把遙測錨定在客戶端能力上的設計都不成立**。腳本模型把遙測錨點搬到腳本自身，不再依賴客戶端是否提供 hook，同時大幅降低維護者上架門檻。

**取捨聲明（須明確承擔）**：本決策以「平台可預測每一步副作用」換取交付速度與覆蓋率。平台不再對安裝步驟做原語級管控，安全邊界改由**發布前審核＋簽名＋演示環境驗證＋使用者可讀預覽**承擔。這是顯式取捨，不是疏漏。

#### 模組結構

| 模組 | 內容 | 產出方 | 可否由維護者修改 |
|---|---|---|---|
| **頭部** | 初始化執行環境；取得已登入使用者 uid；**未登入時生成 UUID 作為標識**；記錄開始時間、腳本版本、PackageVersion、冪等鍵 | 平台生成 | 否 |
| **中間部** | 安裝過程命令；須輸出結構化錯誤日誌 | **維護者在頁面填寫** | 是 |
| **卸載部** | 卸載過程命令；執行時上報卸載事件 | **維護者在頁面填寫** | 是 |
| **底部** | 匯總頭部初始化數據與執行結果，上報成功／失敗／卸載 | 平台生成 | 否 |

平台將四段組合、簽名後生成一鍵安裝腳本供下載。**中間部與卸載部是維護者唯一的可寫區域**，頭部與底部不對維護者開放，確保遙測與身份取得邏輯不被繞過。

#### 使用者標識規則

| 情境 | 標識 | 說明 |
|---|---|---|
| 已登入平台 | 平台 uid | 可歸屬到具體員工，進入待升級名單與通知範圍 |
| 未登入 | **UUID** | 頭部生成並持久化於本機；同一機器重複安裝沿用同一 UUID，不每次新生成 |

- UUID **不得**由平台側推導、關聯或反查真實身份。
- 已登入與未登入的安裝在指標中**分層展示**，不合併為單一成功率——UUID 安裝無法納入「待升級使用者」與 C15b 的通知範圍。
- UUID 的生成方式、持久化位置與保留期須通過隱私審核（A0b），並納入 Metric Contract 的「獨立安裝嘗試」去重定義。

#### 遙測字段白名單（唯一允許集合）

底部模組只允許上報以下字段。**此清單即隱私聲明範圍，也是審核的判斷依據**——超出此範圍的任何收集都不得通過審核。

| 字段 | 內容 |
|---|---|
| OS 系統類型 | `macos` / `linux` / `windows` / `wsl` |
| 使用者標識 | 已登入為平台 uid；未登入為 UUID |
| 工具／技能標識 | Package ID 與 Version |
| 安裝狀態 | 成功 / 失敗 |
| 卸載狀態 | 已卸載 |
| 時間 | 各狀態的發生時間 |

**明確不收集**：提示內容、業務代碼、憑證、完整環境變數、命令輸出全文、檔案路徑、機器名稱、IP、OS 細版本號。

新增任何字段須重新通過隱私審核（A0b），不得以「診斷需要」為由在中間部私自輸出。

#### 殘留副作用聲明（卸載不完整時）

維護者填寫卸載部時，**必須聲明卸載後是否存在無法清除的殘留副作用**：

| 欄位 | 內容 | 必填 |
|---|---|---|
| `has_residual_effects` | 卸載後是否存在殘留 | 是 |
| `residual_description` | 殘留內容說明（例：全域套件、系統設定、外部服務授權）| `has_residual_effects=true` 時必填 |
| `manual_cleanup_steps` | 使用者可自行清理的步驟；無法清理時明確說明 | 同上 |

**執行時序**：腳本執行卸載動作**之前**，若 `has_residual_effects=true`，須先向使用者展示殘留說明與手動清理步驟，取得確認後才繼續。不得在卸載完成後才告知。

此聲明同時展示於下載頁，使用者在安裝前即可知道「這個技能能不能乾淨卸載」。

#### 系統支援聲明

維護者填寫中間部與卸載部時，**必須選擇該段命令適用的系統**：

| 系統標識 | 說明 |
|---|---|
| `macos` | macOS |
| `linux` | 原生 Linux |
| `windows` | 原生 Windows |
| `wsl` | Windows Subsystem for Linux（視為獨立目標，不等同 `linux`）|

平台據此為每個 PackageVersion 標註支援系統矩陣；使用者下載時只取得其系統對應的腳本變體。**未聲明的系統不提供下載**，不做隱式相容假設。

#### 交付與遙測事件

```text
使用者瀏覽技能 → 下載一鍵安裝腳本 ── [ScriptDownloaded：興趣信號]
  → 本機執行 → 頭部取得 uid
  → 中間部執行安裝命令
  → 底部上報 ── [InstallationSucceeded | InstallationFailed：採用信號]
  → （日後）執行卸載 ── [PackageUninstalled：流失信號]
```

三個信號的意義各不相同，且**都是原設計缺失的**：
- **下載** = 興趣。原 PRD 無此指標。
- **安裝成功／失敗 + uid** = 採用。取代原 M8 的 Usage Ping 路徑。
- **卸載** = 流失。原 PRD 完全沒有流失測量，而它比「活躍版本分布」更能說明技能是否真的有用。

#### 實現形態要求

腳本應模組化，或提供 SDK 與 API。**不限定最終實現技術**，但必須滿足：

1. 四個模組職責分離，維護者只能寫中間部與卸載部
2. 頭部的 uid 取得邏輯與底部的上報邏輯不可被中間部覆寫或停用
3. 中間部須支援結構化錯誤輸出，供底部分類上報
4. 卸載部與中間部成對維護——填寫安裝命令後須一併提供卸載命令
5. 未登入時的退化標識規則須固定，並納入 Metric Contract 的去重定義

### 發布審核標準（Pilot 1）

腳本模型放棄原語管控後，**人工審核是主要安全防線**。標準只有兩項，均須通過才可 approve。

#### 標準一：遙測合規

中間部與卸載部的命令，其收集與外傳行為**不得超出 § 遙測字段白名單**。

審核者確認：
- 中間部未私自收集白名單外的資料（環境變數全集、檔案內容、命令輸出全文、憑證等）
- 中間部未向平台以外的位址外傳任何資料
- 中間部未嘗試覆寫、停用或繞過頭部與底部模組

> 第三項與 Spike B1c 是同一件事的兩面：B1c 驗證「機制上能否繞過」，本項驗證「這份提交有沒有嘗試繞過」。

#### 標準二：安裝正確且遙測可得

審核者在演示環境（C14c）實測，確認：
- 腳本在所聲明的每個系統上能正確完成安裝
- 平台確實收到預期的遙測數據與指標，字段內容與白名單一致
- 卸載命令可執行；`has_residual_effects` 的聲明與實際情況相符

#### 執行方式

- **由管理員參考本標準自行決策**，Pilot 1 不做自動化干預，不設自動掃描門檻。
- **Pilot 1 不對審核時效做要求**——單 Package 單作者場景下審核不是瓶頸。
- 審核結論須附理由並進審計；拒絕時回到 `draft`，作者修改後重新審核。

> **已知限制（Expansion 前須解決）**：純人工審核的一致性依賴審核者個人判斷，且多作者上架時會成為交付瓶頸。此限制在 Pilot 1 可接受，但不應延續到 Expansion——見 F13。

### Client 支援範圍模型

**每個 Package 都有自己的 Client 支援範圍，且該範圍會隨適配工作演進——這是 Package 的一級屬性，不是平台的全域設定。**

支援範圍分三層，按適配來源標記：

| `adaptation_source` | 定義 | 信任預設 | 維護責任 |
|---|---|---|---|
| `official` | 技能官方（上游作者）提供的 Client 適配 | 隨 Package 本身的 `trust_tier` | 上游作者 |
| `internal` | 公共架構或內部團隊為公司需求實現的適配 | 需經內部驗證才可升至「已驗證」 | 適配實現者（須在 Manifest 中具名）|
| `community` | 個人或社群實現的適配 | 預設「自定義」，不自動繼承 Package 的 trust_tier | 貢獻者，平台不承諾支援 |

**判定規則**：某技能官方支援 Claude Code 與 Codex、未支援 Gemini，則其支援範圍即為前兩者。若公共架構實現了 Gemini 適配並通過驗證，範圍擴展至三者，該筆標記 `internal`。**平台的職責是如實表達當前範圍並隨之演進，不得把某一時點的範圍當成固定事實。**

### 公司 Client 優先級（適用於 Adapter 建設順序，非 Package 支援範圍）

| 層級 | Client | 說明 |
|---|---|---|
| **P0 優先保證** | Claude Code、Codex | Adapter 優先建設，Pilot 1 從中選定 |
| **P1 涵蓋** | GitHub Copilot、Gemini | Pilot 1 後依採用分布排序納入 |
| **P2 保留擴展** | Cursor、Antigravity CLI、OpenCode、Pi 等 | Manifest schema 支援登記，Adapter 依需求建設 |

此優先級決定**平台投入 Adapter 的順序**，不限制 Package 可宣告的支援範圍——某 Package 若已有 P2 層 Client 的 `official` 適配，仍應如實登記為可發現，只是 Delivery 能力待該 Adapter 就緒。

### Manifest Schema 影響（Pilot 1 即須落地）

`compatibility.clients` 每筆增列三個字段，**Pilot 1 只填 `official`、不實現內部適配的上架審核流程**，但 schema 現在就定義以避免日後破壞性變更：

```yaml
compatibility:
  os: [macos, linux, windows]
  clients:
    - name: claude-code
      version: ">=1.8"
      adaptation_source: official      # official | internal | community
      adaptation_maintainer: null      # internal/community 時必填
      adaptation_verified_at: null     # 內部驗證通過時間，未驗證為 null
```

> 對應 Non-Goal 保護：這是 schema 擴展點，不是 Pilot 1 的工作流。內部適配的提交、審核、信任升級流程屬 **F11**（見 P2）。

### Pilot 1 Support Matrix

`Catalog` = 可發現並查看元數據；`Delivery` = 具備預檢、安裝、驗證、升級、卸載、回滾。

| Package Type | Pilot 1 Catalog | Pilot 1 Delivery | Pilot 2 |
|---|---|---|---|
| Plugin (`superpowers`) | Yes | Pilot 0 選定的單一 Client × 單一 OS | 擴展第二個 OS 或 Client |
| Skill | Schema only | No | Yes |
| Plugin（其他）| Schema only | No | Yes |
| MCP | Metadata only | No | 僅預批准 MySQL MCP |
| Bundle | Metadata only | No | 另立里程碑 |

「Schema only」不宣稱員工可以安裝，只保證未來加入類型時不需重建 Package 身份與版本模型。

**Client 選擇的雙重約束**：Pilot 1 的 Client 必須同時滿足 (i) 落在 `superpowers` 當前支援範圍內、(ii) 通過 A0 兜底能力篩選。前者由 Package 決定，後者由平台需求決定——**兩者的交集若為空，須先擴展適配範圍或更換試點 Package，不得跳過任一項**。

### Pilot 1 唯一交付合同（Pilot 0 後必須以實值取代）

| Contract Field | Required Value |
|---|---|
| Package | `superpowers` |
| Package Type | `plugin`，Technical Spike 必須驗證 |
| Package Version | `TBD` |
| Client | `TBD`（須落在 `superpowers` 支援範圍 ∩ A0 通過名單）|
| Client Version | `TBD` |
| Client 適配來源 | `TBD`（`official` / `internal`；若為 `internal` 須具名維護者）|
| OS | `TBD` |
| OS Version | `TBD` |
| Adapter ID / Version | `TBD` |
| Artifact Digest | `TBD` |

> 若 Technical Spike 證明 `superpowers` 的實際包裝不是 Plugin，必須先修正文檔與支持矩陣，**不能在實現中靜默改型**。

### 最低可發布路徑

```text
SSO 使用者 → Web 查看已發布 superpowers Plugin → CLI 預檢與 UserConsent
  → 下載平台簽名的一鍵安裝腳本 → 本機執行、上報 → 作者查看下載／安裝／卸載三段漏斗
```

### 測試策略摘要

- **Contract Tests**：Manifest 向後兼容與遷移、Adapter 接口一致性、Event Schema 兼容、Policy 輸入與決策輸出、三個狀態機的合法轉換、InstallPlan 原語 Allowlist。
- **Integration Tests**：手工導入→Catalog、發布→可發現、預檢→安裝成功、失敗→回滾、新權限升級→差異展示→重新同意、緊急禁用→阻止新安裝、斷線→補交→去重、三方合併與本機衝突、Artifact 摘要／簽名／保留／回滾、**平台側不可用→Degraded Mode 路徑**。<br>*（Git 自動同步、`InstallationApproval` 過期／撤銷、停用已安裝＋回執——隨 S6／S7／C15b 一併延後或條件納入）*
- **Security Tests**：惡意中間部命令能否通過發布前審核（紅隊至少 3 種攻擊樣本）、**中間部繞過或停用頭部／底部的嘗試**、腳本簽名與下載後篡改、路徑穿越與命令注入、RBAC 越權、憑證與日誌泄漏、下載入口撤下的即時性。<br>*（腳本模型放棄原語 Allowlist 後，安全重心從「限制可執行的操作」轉為「審核＋簽名＋不可繞過的遙測邊界」——第二項是新增的關鍵測試，對應 B1c。）*
- **E2E Tests**：員工從搜尋→下載→安裝→首次成功運行→卸載的完整生命週期、作者填寫中間部與卸載部並發布、作者查看下載／安裝／卸載三段漏斗、管理員撤下版本並通知受影響使用者。

---

## 7. Open Questions

| # | Question | Owner | Deadline |
|---|---|---|---|
| ~~Q0~~ | ~~候選 Agent 客戶端中，哪些提供簽名 Check-in、Plugin 載入 Usage Ping 與可驗證停用接口？~~ | — | **已於 2026-08-12 完成**，見 [a0-client-capability-matrix.md](./a0-client-capability-matrix.md)。結論：**五個候選全部不提供週期性簽名 Check-in**（架構性缺失，非選型問題）；停用能力五者皆有但生效時點為「下次 session 啟動」；Usage Ping 除 Cursor 外皆可經 `SessionStart` hook 間接實現 |
| ~~Q0b~~ | ~~M9 應如何改寫？~~ | — | **已決（2026-08-12）**：managed settings 下發路徑明確不採用；M9 取消時間 SLO，改為聲明能力範圍——撤下下載即時阻止新安裝，已安裝實例無遠端停用能力，改以通知＋一鍵卸載腳本處理 |
| ~~Q0c~~ | ~~`SessionStart` hook 上報是否滿足「活躍安裝」定義？~~ | — | **已決（2026-08-12）**：不採用 hook 上報。改由一鍵安裝腳本的底部模組上報，並新增下載（興趣）與卸載（流失）兩個信號 |
| ~~Q0d~~ | ~~未登入使用者的退化標識採何種形態？~~ | — | **已決（2026-08-12）**：使用 UUID，本機持久化、重複安裝沿用同一值、不可反查真實身份。已登入與 UUID 安裝在指標中分層展示。生成方式、持久化位置與保留期仍須通過隱私審核（A0b）|
| ~~Q0e~~ | ~~中間部命令的發布前審核標準為何？~~ | — | **已決（2026-08-12）**：兩項標準——(1) 遙測合規，不得超出白名單、不得外傳、不得繞過頭部底部；(2) 演示環境實測安裝正確且遙測可得。由管理員參考標準自行決策，不做自動化干預。見 § 發布審核標準 |
| ~~Q0f~~ | ~~卸載命令無法完全覆蓋安裝副作用時如何處置？~~ | — | **已決（2026-08-12）**：由發布者聲明 `has_residual_effects`，為 true 時須填寫殘留說明與手動清理步驟；腳本在**執行卸載動作前**提示使用者並取得確認；下載頁同步展示 |
| ~~Q0g~~ | ~~審核者的響應時效與積壓如何處理？~~ | — | **已決（2026-08-12）**：Pilot 1 不做時效要求。此決定僅適用於單 Package 單作者場景；多作者上架前須重新評估，見 F13 |
| Q1 | 第一個正式支援的 Agent 客戶端是哪一個？ | 公共架構技術賦能 Owner | Pilot 0 結束。**候選收斂為 P0 層的 Claude Code 與 Codex**；兩者在 A0 能力維度無差異，選擇取決於 A0d（`superpowers` 官方適配範圍）與 Pilot 0 的公司實際分布 |
| Q2 | 第一個正式支援的作業系統是哪一個？ | 公共架構技術賦能 Owner | Pilot 0 結束 |
| Q3 | `superpowers` 的現有安裝步驟能否完全聲明化，還是包含不可重放的人工配置？ | Technical Spike 負責人 | Spike Gate |
| Q4 | 公司是否允許本機安裝器執行受控命令，還是必須透過受管終端或軟件中心？ | 安全 | Pilot 0 結束 |
| Q5 | Q0 篩選出的 Client，其 Check-in 頻率與停用生效時點的**實測值**為何？ | Technical Spike 負責人 | Spike Gate（Q0 確認能力存在，Q5 確認效能達標）|
| Q5b | 若無任何 Client 通過 Q0，替代兜底（發布前灰度）的分批範圍與觀察窗口如何定義？ | 公共架構 ＋ 安全 | Q0 結果為否時，Pilot 1 啟動前 |
| Q5c | 若通過 Q0 的 Client 不是公司主流客戶端，如何在「採用數據完整性」與「員工覆蓋率」之間取捨？ | 公共架構負責人 | Q1 決策時（此權衡理由須書面記錄，避免為保住 M8 而選擇覆蓋率明顯更差的 Client）|
| Q6b | `superpowers` 上游發布新版本時，誰負責更新公司 Manifest、誰負責重跑 Spike 驗證？ | 公共架構 | Pilot 1 啟動前 |
| Q6c | Pilot 1 驗證的是「內部團隊代理發布外部技能」，而 Expansion 的主要場景是「內部作者發布自己的技能」——兩者在 Manifest 維護責任、版本跟進節奏、上游變更響應上不同。Pilot 1 的發布管線對 Expansion 有多少參考價值？ | 公共架構 | Phase E 啟動前 |
| Q6 | 公司推廣最終需要「推薦」「默認安裝」還是「強制安裝」？ | 公共架構 ＋ 安全 | Pilot 1 結束後 |
| Q7 | 如何定義一次真實採用：安裝成功、首次調用、七日活躍，還是業務任務完成？ | 產品 ＋ 公共架構 | Pilot 1 結束後（Pilot 1 暫定為「成功安裝＋一次本機驗證」）|
| Q8 | 個人自定義技能能否直接被團隊搜尋，還是需要作者主動提交？ | 公共架構 | Expansion 階段前 |
| Q9 | 評分是否必須綁定已驗證安裝與具體版本，以避免無使用經驗的投票？ | 產品 | F1 啟動前 |
| Q10 | 公司安全審計政策的保留期為何？（Policy 評估與審批記錄沿用；若尚無政策，生產前必須確定）| 安全 ＋ 法務 | Pilot 1 上生產前 |

### 必須在工程計劃前確認的外部依賴

1. 公司主要 Agent 客戶端及版本分布
2. macOS／Linux／Windows 員工比例
3. 現有 SSO、組織目錄與 RBAC 能力
4. Git 託管、CI、Artifact Registry 與軟件分發渠道
5. Secret Manager 或短期憑證服務
6. 是否已有 Backstage 或其他內部開發者門戶
7. 允許收集的安裝遙測字段
8. 公共架構、安全、DBA、法務、開源辦公室的審批責任

---

## 8. Timeline & Phasing

### Phase A — Pilot 0：建立基線（約 2 週，不寫平台代碼）

選 `superpowers` ＋ 一名公共架構技術賦能工程師為單一試點。招募 10–20 名真實員工，讓他們自行使用現有材料，觀察員不在旁指導。

**前置（Phase A 啟動前）**：
- A0／Q0 — Client 兜底能力查證，產出候選名單（1–2 天，不需等 Pilot 0 開始）
- A0c — 指定兩名 Gate 共簽人，姓名寫入 PRD
- A1c — 決定基線記錄方式（Owner 自記並明示限制 or 交叉記錄）
- § 指標歸屬聲明 — 與 stakeholder 就「技術指標達標但 M5 未達標」的判定口徑取得共識

**並行（與 Pilot 0 觀察同時啟動）**：A0b 隱私審核送審。此項週期不可控，不得等 Pilot 1 設計完成。

**交付物**：基線數據（安裝人數／成功數／首次成功時間／**四類中斷分布**／作者中斷次數與耗時／OS·Client·版本分布）、凍結的 Metric Contract、無 `TBD` 且 Client 通過 A0 篩選的 Support Matrix、Top 10 問題清單、對照組支援負擔數據、重估後的 Pilot 1 工期與可驗收工作包。

**Exit Gate**：Support Matrix 無 `TBD` 且 Client 通過 A0 三項篩選。否則不得估算或開始 Pilot 1。若安裝類中斷佔比 <60%，M5 目標值須先重算（見 A1b）。

### Phase B — Technical Spike Gate（Pilot 1 開發前）

針對真實 `superpowers` Plugin ＋ 選定 Client ＋ 選定 OS 完成 B1–B6（含 B1b／B4b／B4c）全部驗證。

- B4 涵蓋客戶端側故障，B4b 涵蓋平台側故障——兩者都是 Gate 條件。
- B1b 的閾值須在 Spike **啟動前**生效，不得在 B1 失敗後臨場調整。
- **B1c 是新增的最高優先驗證項**：若中間部能繞過或停用頭部／底部，整個遙測模型失效，須停止 Pilot 1 重新設計上報機制。
- B4c 的上報補交實測結論必須落回 PRD。

**Exit Gate**：四段式腳本完成安裝與卸載 ＋ **頭部／底部不可被中間部繞過（B1c）** ＋ Support Matrix 無 `TBD` ＋ 禁用能力上限已如實聲明。未達標則按 B1b 閾值裁決。

### Phase C — Pilot 1：閉環安裝

**工期**：待 Pilot 0 後重估。概念區間為人工 7–10 週、AI 輔助 2–3 週，**這不是交付承諾**。SSO、Git、分發或本機執行權限未就緒時不得沿用此估算。

10–20 名跨後端／前端／產品／DBA 的員工用平台安裝同一版本。觀察使用者，不做引導式演示；記錄預檢命中率與自動修復率；每個失敗必須落入可操作錯誤分類；與 Pilot 0 基線比較作者支援成本。

**推廣 Gate**：至少累積 50 次獨立安裝嘗試，報告成功率的 Wilson 95% 信賴區間；不以單一點估計宣稱達標。

### Phase D — Pilot 1 Should Have

僅在 Phase C 達成成功標準後啟動 S1–S5。

### Phase E — Pilot 2：第二種 Package 類型（另立里程碑）

加入 DBA 預批准的單一 MySQL MCP（固定版本、固定啟動方式、只讀資料庫角色、最小權限模板），驗證權限聲明、憑證引用、DBA 審批、高風險工具允許清單與審計。不承諾通用 MCP 腳本掃描或跨 OS 沙箱。

### Phase F — Expansion

兩種類型、兩個團隊完成閉環後，才引入 `pm-skill`、`gsd-core` 與員工自定義技能上架。

### 依賴關係

```text
Phase A (Pilot 0) ──必須無 TBD──> Phase B (Spike) ──必須全項通過──> Phase C (Pilot 1)
                                                                        │
                                        Phase D (Should Have) <──成功標準達成──┤
                                                                        │
                                        Phase E (Pilot 2) <──閉環驗證──────┘
                                                                        │
                                        Phase F (Expansion) <──兩類型兩團隊──┘
```

---

## Appendix A: Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 先建商城、後補安裝 | 平台有瀏覽量但不降低支援成本 | Pilot Gate 必須以安裝成功率與作者中斷為成功標準（M1／M5）|
| 支援過多客戶端 | 適配器矩陣拖慢交付 | Pilot 1 只選 1 個 Client × 1 個 OS |
| **維護者填寫的安裝命令帶來供應鏈與終端安全風險** | 腳本模型放棄原語管控後，這是本架構最主要的殘餘風險，且**已顯式接受** | 發布前人工審核＋靜態掃描、腳本簽名與摘要驗證、演示環境驗證、使用者可讀全文預覽、B1c 紅隊測試、下載入口可即時撤下 |
| **中間部繞過頭部／底部** | 遙測不可信，M1／M8／M8b／M8c 全部失效 | B1c 列為 Spike 最高優先驗證項；失敗即停止 Pilot 1 |
| 遙測收集過度 | 員工不信任或觸犯政策 | 最小事件 Schema、脫敏、隱私審核（M7／C16）|
| 提前微服務化 | 延遲 MVP 並增加故障面 | 模組化單體＋Outbox，按證據拆分 |
| 作者維護責任不清 | 技能過期無人支援 | 強制 Owner、支援渠道、棄用策略 |
| 強制推廣無回滾 | 大範圍破壞開發環境 | Non-Goal 5 明確禁止；分批推廣、延期窗口、例外、回滾演練 |
| 自定義技能泛濫 | 搜尋噪音與重複技能 | 可見性分層、重複檢測、領域審核（延至 Phase F）|
| Support Matrix 帶 `TBD` 開工 | 估算失準、實現中靜默改型 | Phase A／B 雙 Exit Gate 硬阻塞 |
| 選定 Client 不支援 Check-in | 平台失去止血能力；M8／M9 無法兌現卻已對外承諾 | A0／Q0 前移為 Client 篩選條件；全數不通過時，按 D5 明確聲明禁用能力上限並改用發布前灰度 |
| 平台自身不可用 | 員工撞上不可用窗口，第一印象定型；統計被污染 | § Degraded Mode（D1–D5）＋ Spike B4b 平台側故障注入 |
| M5 目標值數學上不可達 | 指標未達成被誤判為項目失敗 | A1 四類中斷分類 ＋ A1b 事前重算目標值 ＋ § 指標歸屬聲明 |
| Adapter 按容易樣本設計 | 第二個技能上來時接口返工 | A4b 對照組（`pm-skill`／`gsd-core`）校準複雜度基準，含定性訪談保底 |
| **Gate 在排期壓力下被默認滑過** | 帶 TBD 開工，Adapter 按錯誤假設定型，返工成本遠超延期成本 | A0c 指定兩名共簽人；繞過須為顯式書面決策（見 Gate 裁決規則）|
| **Spike B1 失敗時臨場妥協** | 三選一無判斷標準，演變為「先做著看看」 | B1b 事前定義閾值（1–2 個手動步驟可繼續；≥3 個或涉權限授予則停止）|
| **D1 寫得出來但跑不通** | Degraded Mode 最關鍵路徑是空頭支票，兜底等於沒有 | B4c 列為必須實測項；不通過即降級為 D3 並修改 PRD 措辭 |
| **隱私審核在 Phase C 中期才卡住** | Goal 3 與 C13a／C13b 當期失效，失去對上主要交付物 | A0b 提前為 Phase A 並行工作項，送審材料為 § 遙測字段白名單 ＋ UUID 規則 |
| **P0 範圍膨脹至接近完整平台首發** | 與「Pilot Release 而非完整首發」的自我定位背離，稀釋單一閉環的驗證強度 | Phase C 收斂為 13 條（含 2 條條件式）；C11／C14 的非必要部分降級為 S6／S7；C17 改為 DoD |
| **平台故障期污染成功率統計** | Gate 判斷失真 | D2／D4 綁入 M1 驗收條件，未實作即 M1 未完成 |
| 為保住採用數據而選次優 Client | 覆蓋率受損，員工體驗下降 | Q5c 要求權衡理由書面記錄 |
| 上游 `superpowers` 發新版無人跟進 | Manifest 過期，Pilot 1 驗證結果失效 | Q6b 於 Pilot 1 啟動前確定責任人 |

## Appendix B: Reviewer Concerns（來自設計檔，尚未消除）

三輪對抗式審閱後仍有兩項不能靠文檔推理消除的外部證據缺口：

1. Pilot 1 的 Client、Client Version、OS、OS Version、Package Version、Adapter 與 Artifact Digest 尚未由 Pilot 0 實測確定。Support Matrix 存在任何 `TBD` 時，不得開始估算或實現。
2. 10 分鐘緊急禁用 SLO 取決於選定 Client 是否支援 5 分鐘簽名 Check-in 與可驗證 Plugin 停用。Technical Spike 未證明前，這只是候選目標，不是交付承諾。

**Red-team 補充（2026-08-12）**：第 2 項的處理已調整——原本把 Check-in 能力留到 Spike 驗證，但 Client 在 Pilot 0 結束時就已選定，屆時才發現不支援會導致 Phase A 部分產出作廢。現改為 A0／Q0 前移為 Client 篩選條件（查文檔 1–2 天），Spike 只驗證實測效能。同時新增 § Degraded Mode 補齊平台自身不可用的路徑——此為原設計檔未覆蓋的缺口，設計檔僅處理了已安裝技能的離線運行，未處理平台不可用時員工的安裝路徑。

## Appendix C: References

- [Open Agent Skills Specification](https://openagentskills.dev/docs/specification)
- [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [GitHub Copilot Plugins](https://docs.github.com/en/enterprise-cloud%40latest/copilot/concepts/agents/about-plugins)
- [GitHub Enterprise MCP Access](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-server-access)
- [HTML 線框圖](./agent-skill-platform-wireframe.html)
- [完整設計檔](./agent-skill-platform-design.md)（領域模型、狀態機、Adapter 接口、Event Contract、API Surface、Failure Cases 的完整定義）

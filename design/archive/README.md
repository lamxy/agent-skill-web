# 歸檔說明

**歸檔日期**：2026-08-13
**歸檔原因**：PRD 定位於 2026-08-13 從「驗證項目是否值得做」轉為「以 MVP 實現為直接目標」，且交付架構於 2026-08-12 從「InstallPlan 原語模型」改為「三段式一鍵安裝腳本模型」。以下文件建立在已被取代的前提上。

**標識含義**：
- `【歸檔-建議刪除】` — 內容已被現行文件取代，保留僅供追溯決策過程；確認無需回查後可刪除。

---

## 1.【歸檔-建議刪除】agent-skill-platform-prd.v1-validation.md

**原身分**：PRD 第一版（驗證導向），689 行

**過時原因**：

整份文件的骨架是「證明項目值得做」——Phase A 基線觀察、Phase B Technical Spike Gate、Phase C 閉環安裝，以及貫穿其中的 Exit Gate 與共簽機制。新定位下這些不再是開工前置，效果驗證改由上線後的真實遙測與反饋渠道承擔。

**具體失效內容**：
- Phase A/B/C 三階段與雙 Exit Gate（Support Matrix 無 `TBD` 才可開工）
- Gate 裁決人共簽規則、繞過需書面決策
- 指標歸屬聲明、M5 目標值事前校準、條件式 P0 決策表
- Technical Spike 的 B1–B6 驗證項
- 基線觀察、對照組、四類中斷分類作為硬前置

**仍有參考價值**：
- pre-mortem 五隻 Elephant 的完整處置（組織性風險，文檔外仍存在）
- 三輪 red-team 的推導過程與被否決的方案
- InstallPlan 原語模型的完整設計（若日後需要更強的安全管控，可回查）

**可刪除的判準**：確認不需要回溯「為何放棄原語模型」「為何取消 Gate」這兩個決策的推導過程後即可刪除。核心結論已寫入現行 PRD。

---

## 2.【歸檔-建議刪除】agent-skill-platform-premortem.md

**原身分**：Pre-mortem 風險分析（9 Tigers、4 Paper Tigers、5 Elephants），161 行

**過時原因**：

推演對象是舊架構與舊定位。四隻 launch-blocking Tiger 中：

| Tiger | 現狀 |
|---|---|
| T1 Gate 被繞過 | **失效** —— Gate 機制已取消 |
| T2 Spike B1 失敗無判斷標準 | **失效** —— Spike Gate 已取消 |
| T3 D1 是空頭支票 | **已消解** —— 腳本模型下安裝不依賴平台，該風險不存在 |
| T4 隱私審核中期才卡住 | **仍有效** —— 已轉入現行 PRD §7 外部依賴 |

**仍有參考價值**：

五隻 Elephant 是組織性議題，不隨架構變更而消失：
- E1 老闆指令讓 Gate 難守（Gate 已取消，但「壓力下走捷徑」的機制仍在）
- E2 平台可靠性可交付、作者中斷下降不完全可控
- E3 Owner 同時是試點對象、記錄者與推動者
- E4 `superpowers` 是外部開源技能，內部代理發布 vs 內部作者發布的差異
- E5 項目也在證明團隊價值，可能影響技術選型

**可刪除的判準**：這五條若已在團隊內部討論過並形成共識，即可刪除。若尚未討論，建議先讀 § Elephants in the Room 再刪。

---

## 3.【歸檔-建議刪除】agent-skill-platform-wireframe.html

**原身分**：粗線框圖（技能池、詳情、安裝預檢、推廣成效），196 行

**過時原因**：

包含「**安裝預檢**」頁面——該概念屬 CLI 原語模型：平台簽發 InstallPlan、CLI 執行預檢後才安裝。腳本模型下沒有預檢步驟，員工直接下載腳本執行，檢查邏輯（若有）在中間部由維護者自行實現。

**其他不符現行設計之處**：
- 缺少下載入口與下載即興趣信號的表達
- 缺少卸載能力與殘留副作用聲明展示
- 缺少維護者填寫中間部／卸載部的入口
- 缺少審核工作台與待審核不可見狀態
- 「推廣成效」未含三段漏斗（下載→安裝→卸載）

**仍有參考價值**：技能池列表與詳情頁的資訊層級大體仍適用，可作為新線框的起點。

**可刪除的判準**：新線框圖產出後即可刪除。在此之前保留作為版面參考。

---

## 現行有效文件（位於上層目錄）

| 文件 | 身分 | 狀態 |
|---|---|---|
| `agent-skill-platform-prd.md` | **實施主文件** | 最新，2026-08-13。七模組拆解、資料模型、實施順序、六項待解難題 |
| `a0-client-capability-matrix.md` | 技術查證報告 | 有效。五個客戶端的能力實測結論，是「腳本模型不依賴客戶端 hook」的依據 |
| `agent-skill-platform-design.md` | 原始設計檔 | **部分有效，需選讀** —— 見下方說明 |

### 關於 `agent-skill-platform-design.md`

原始設計檔（1125 行，2026-08-04 APPROVED）**未隨後續決策更新**，其中這些章節已被取代：

- § InstallPlan 限制（9 個操作原語）→ 已改為腳本模型
- § Emergency Revocation（Revocation List、5 分鐘 Check-in、10 分鐘 SLO）→ A0 證明不可行
- § Adapter Model 的 preflight/plan/install 接口 → 腳本模型下不適用
- § Phase 1 Scope 的 Pilot 0/1/2 劃分 → 定位已變更
- § Success Criteria 的具體目標值 → 改為上線後依真實數據設定

**仍然有效且有價值的章節**：Problem Statement、Demand Evidence、Status Quo、Landscape Findings、Domain Model 的 Package/PackageVersion 部分、Failure and Edge Cases、Open-Source Export。

> 建議：把它當作**背景與問題陳述的來源**，技術方案一律以現行 PRD 為準。若兩者衝突，以 PRD 為準。

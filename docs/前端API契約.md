# 前端 API 契約

本文件盤點 Task #9 前端需要對接的後端端點，作為子任務 9.1 的查詢層依據。內容由 `src/modules/*/index.ts` 的實際路由推導，不是設計稿；端點變更時必須同步更新本文件。

前端技術選型尚未確定，見 `docs/待決策與延後事項.md` 的 D-1。本文件只描述 HTTP 契約，不依賴任何框架。

## 通用約定

所有端點掛在 `/api` 前綴下，回應為 JSON。身份以 `HttpOnly` Cookie 承載的 opaque session 傳遞，因此前端請求必須帶上 credentials；同源部署時瀏覽器預設即會攜帶。

錯誤回應由 `registerErrorHandler` 統一產生，前端不應解析內部細節，只依狀態碼與錯誤欄位決定 UI 呈現。

`GET /health` 回 `{ status: 'ok', database: 'up' }`，資料庫不可用時回 503 與 `degraded`。此端點供運維與容器健康檢查使用，不是前端頁面資料來源。

## 頁面狀態映射

TypeScript 的唯一來源是 `CatalogPageState<T>`，五種狀態的語義定義在 `docs/目錄頁狀態契約.md`，本文件不重複。

責任邊界必須明確：搜尋與詳情 API 只回傳 `empty` 或 `success`。`loading`、`error` 與 `partial` 由前端查詢層依請求生命週期與部分失敗情形映射，不是後端欄位。

- 請求發出但尚未回應，映射為 `loading`。
- 網路失敗或 5xx，映射為 `error`；依錯誤性質決定 `retryable`。
- 核心資料成功但非核心區段失敗，例如詳情頁取得套件資料卻無法取得採用統計，映射為 `partial` 並在 `unavailableSections` 列出缺失區段。

## 端點清單

### 目錄（catalog）

| 方法 | 路徑 | 用途 | 使用頁面 |
|---|---|---|---|
| GET | `/api/packages` | 搜尋與篩選（只回傳有已發布版本者） | 技能池列表頁 |
| GET | `/api/packages/mine` | 可維護的套件，含尚無已發布版本者 | 我維護的技能頁 |
| POST | `/api/packages` | 建立套件 | 發布新技能頁 |
| GET | `/api/packages/:packageId` | 套件詳情 | 詳情頁、安裝頁 |
| PATCH | `/api/packages/:packageId` | 更新套件 | 發布流程 |
| DELETE | `/api/packages/:packageId` | 刪除套件 | 管理後台 |
| POST | `/api/packages/:packageId/versions` | 建立版本 | 發布流程 |
| PATCH | `/api/packages/:packageId/versions/:version` | 更新版本 | 發布流程 |
| GET | `/api/packages/:packageId/versions/:version` | 讀取版本與完整 target Matrix | 更新技能版本頁重載 |
| GET | `/api/packages/:packageId/versions/:version/download` | 下載入口 | 詳情頁、安裝頁 |

#### 腳本目標（script targets）

腳本命令的真實來源是 target／revision，不是 package version 的單一命令欄位。

| 方法 | 路徑 | 用途 |
|---|---|---|
| POST | `/api/packages/:packageId/versions/:version/script-targets` | 新增空白待填組合 |
| PUT | `/api/packages/:packageId/versions/:version/script-targets/:targetId` | 保存一次完整 revision |
| POST | `/api/packages/:packageId/versions/:version/script-targets/:targetId/copy-from` | 從其他組合複製為獨立快照 |
| DELETE | `/api/packages/:packageId/versions/:version/script-targets/:targetId` | 軟刪除組合 |
| GET | `/api/packages/:packageId/versions/:version/script-targets/:targetId/revisions` | 讀取版本歷程 |

`targetOs` 只接受 `linux/macos`、`windows`、`wsl`；`clientRuntime` 只接受 `claude-code`、`codex`。

PUT、copy-from 與 DELETE 都需帶 `expectedScriptVersion` 做 CAS；不符時回傳 409 `SCRIPT_TARGET_REVISION_CONFLICT`。首次完整保存為 v1，其後單調遞增。軟刪除只隱藏 current revision，歷程仍可查；重建同組合沿用同一 `targetId` 並從 `max(script_version)+1` 續號。

選項名須符合 `^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`，最多 20 個；`hasResidualEffects` 為 true 時 `residualDescription` 與 `manualCleanupSteps` 皆必填。違反時回傳 400。

複製後的目的組合帶 `copiedFrom`；之後任何一次手動 PUT 都會清除該標記，且不回寫來源。

送審前每個 active target 都必須有 current revision、兩種命令與 usage，且不可是 legacy imported revision；否則 `POST /api/packages/:packageId/versions/:version/submit-review` 回傳 409 `SCRIPT_TARGETS_INCOMPLETE`。

`GET /api/packages` 的查詢參數為 `keyword`、`category`、`client`、`os`、`cursor`、`limit`、`sort`，其中 `limit` 介於 1 至 100，`sort` 只接受 `name_asc`、`name_desc`、`updated_desc`。分頁採 cursor，前端不得自行組裝 offset。

`GET /api/packages/:packageId` 回應已包含 `state: 'success'` 欄位，前端沿用該欄位而非另行判斷。

下載入口只對 `published` 版本開放。`review_required` 版本即使作者或審核者能在詳情看見，也不提供下載按鈕。

#### 版本差異（Task 11）

| 方法 | 路徑 | 用途 |
|---|---|---|
| GET | `/api/packages/:packageId/versions/:version/diff/:targetVersion` | 兩個版本的升級差異 |

`:version` 是使用者目前安裝的版本，`:targetVersion` 是要升級到的版本。兩者都必須是呼叫者本來就看得到的版本，否則回 404 `PACKAGE_VERSION_NOT_FOUND`；差異端點不是探測未發布內容的旁路。

回應為 `VersionDiff`：`direction` 為 `upgrade`／`downgrade`／`same`，`scriptTargets` 逐一列出每個「系統 × Client」的 `change`（`added`／`removed`／`changed`／`unchanged`）與各項變更旗標，`residualEffects` 標示殘留副作用是否為本次新增，`reapprovalReasons` 逐條說明為何需要使用者重新確認。

差異結果**不含命令全文**，只回傳 `contentDigest`、`scriptVersion` 與變更旗標。這維持「詳情頁不攤開中部命令」的既有規則；使用者要看完整腳本仍需經安裝頁。

`requiresReapproval` 的語義是「使用者升級前需重新確認」，不是治理層的重新送審。命令、選項或殘留副作用改變時，原本的安裝決策依據就不再成立。

升級不需要新端點：確認差異後沿用既有 `POST .../scripts` 生成目標版本的安裝腳本。

### 體驗（experience，Task 11）

| 方法 | 路徑 | 用途 | 權限 |
|---|---|---|---|
| GET | `/api/packages/:packageId/support-channels` | 讀取支援入口 | 可見該套件者 |
| PUT | `/api/packages/:packageId/support-channels` | 整組覆寫支援入口 | 維護者 |
| POST | `/api/packages/:packageId/feedback` | 提交反饋 | 含匿名 |
| GET | `/api/packages/:packageId/feedback` | 反饋明細 | 維護者 |
| GET | `/api/packages/:packageId/feedback/summary` | 反饋統計 | 維護者 |
| PATCH | `/api/feedback/:feedbackId` | 變更反饋處理狀態 | 維護者 |

支援入口 `channelType` 只接受 `im_group`、`email`、`ticket_system`、`doc`，最多 10 筆，`label` 與 `address` 皆必填。PUT 是**整組覆寫**：送出的清單即為完整結果，未列出的既有渠道視為刪除，前端必須送出完整清單而非增量。

反饋開放匿名 UUID 提交，因為安裝腳本的使用者不一定登入，要求登入會讓最需要協助的失敗案例回報不上來。但反饋明細含自由文字，只有維護者可讀；一般員工讀取回 403，匿名讀取回 401。

`satisfaction` 為 1 至 5 的整數，`issueCategory` 為七個固定值，`detail` 必填且不得為空白。`needsHumanSupport` 標記需要人工協助。

統計的 `byCategory` 固定回傳全部七個分類（含計數 0）：缺席的分類與「無人回報」是兩件事，隱藏會讓讀者誤判分佈。`averageSatisfaction` 在沒有樣本時為 `null`，不得渲染為 0。滿意度是自願填寫的自我聲明，與遙測同屬 best-effort，介面必須標示參考性質。

### 分析（analytics）

| 方法 | 路徑 | 用途 | 使用頁面 |
|---|---|---|---|
| GET | `/api/packages/:packageId/analytics` | 套件分析資料 | 作者分析頁 |
| GET | `/api/me/installations` | 我的安裝清單 | 我的安裝頁 |

分析端點的 `start` 與 `end` 為必填查詢參數。回應包含三段漏斗、含 Wilson 信賴區間的成功率、失敗分布、版本分布與待升級使用者。

前端必須分開呈現 `uid` 與 `uuid`，並顯示 `best-effort` 標記與「數據僅供參考」說明。沒有數據時成功率為 `null`，不得渲染為 `0%`。

### 治理（governance）

| 方法 | 路徑 | 用途 | 使用頁面 |
|---|---|---|---|
| POST | `/api/packages/:packageId/versions/:version/submit-review` | 提交審核 | 發布流程 |
| GET | `/api/reviews` | 待審列表 | 審核工作台 |
| GET | `/api/reviews/:id` | 審核詳情 | 審核工作台 |
| POST | `/api/reviews/:id/approve` | 核准 | 審核工作台 |
| POST | `/api/reviews/:id/reject` | 駁回 | 審核工作台 |
| POST | `/api/packages/:packageId/versions/:version/validation/retry` | 重試驗證 | 審核工作台 |
| POST | `/api/packages/:packageId/versions/:version/deprecate` | 標記淘汰 | 管理後台 |
| POST | `/api/packages/:packageId/versions/:version/delist` | 版本撤下 | 管理後台 |
| POST | `/api/packages/:packageId/versions/:version/emergency-disable` | 緊急停用 | 管理後台 |
| GET | `/api/notifications` | 通知清單 | 全域 |
| POST | `/api/notifications/:id/read` | 標記已讀 | 全域 |

審核詳情需呈現命令全文、支援系統、殘留聲明與遙測預覽。作者迴避規則由後端強制，前端仍應在介面上明示，避免使用者誤以為可以自審。

三個下架端點的差異只在稽核語意與執行權限：對員工的效果完全相同，都會立即停止腳本生成並讓版本從技能池消失。`deprecate` 與 `delist` 維護者可執行，`emergency-disable` 僅 global platform_admin。`delist` 的 `effectiveAt` 必須是當下或過去，第一期不支援排程；`deprecate` 只收單一 `reason`，沒有 `reasonCode` 與 `effectiveAt`，payload 形狀與另外兩者不同。

三者**都不可逆**：版本狀態機（`src/modules/governance/version-state-machine.ts`）沒有回到 `published` 的轉換，`emergency_disabled` 更是最終狀態。介面必須明示這點，否則使用者會以為「標記棄用」較溫和而事後可反悔。恢復能力見任務 20。

撤下、緊急停用與刪除屬不可逆操作，必須有二次確認。

`GET /api/notifications` 的 `notificationType` 有三種：`version_delisted`、`version_emergency_disabled` 與 Task 11 新增的 `version_published`。前三者的 `version` 是被撤下或停用的版本；`version_published` 的 `version` 是**新發布**的版本，收件人是裝了同套件其他版本的 UID，payload 可能含 `releaseNotes`。前端據此提供「檢視差異」入口，導向版本差異端點。

發布通知的收件人排除作者本人與匿名 UUID，也排除已經裝在該新版本上的人。第一期平台內通知是唯一渠道；IM 與郵件外部 dispatcher 依 Task #6 決策屬第二期。

### 身份（identity）

| 方法 | 路徑 | 用途 | 使用頁面 |
|---|---|---|---|
| GET | `/api/auth/login` | 發起登入 | 全域 |
| GET | `/api/auth/callback` | 登入回呼 | 全域 |
| GET | `/api/auth/me` | 目前身份 | 全域 |
| POST | `/api/auth/logout` | 登出 | 全域 |
| GET | `/api/admin/reviewers` | 有效審核者指派 | 管理後台 |
| GET | `/api/admin/reviewer-candidates` | 可指派的有效身份候選 | 管理後台 |
| POST | `/api/admin/reviewers` | 新增審核者 | 管理後台 |
| DELETE | `/api/admin/reviewers/:id` | 移除審核者 | 管理後台 |

`GET /api/auth/me` 是前端判斷角色與可見功能的唯一來源。前端的隱藏或停用只是體驗處理，真正的授權在伺服器端；不得以前端判斷取代後端校驗。

### 權限模型（2026-08-29 收斂）

| 身份 | 可做什麼 |
|---|---|
| 未登入 | 瀏覽公開技能、下載安裝腳本 |
| 已登入無角色（員工） | ＋發布新技能、更新自己團隊的技能 |
| `maintainer` | ＋更新所有技能（跨團隊） |
| `reviewer` | ＋審核所有技能，除自己送審的 |
| `platform_admin` | 全部；只能由 `BOOTSTRAP_ADMIN_UID` 產生 |

「自己團隊」以套件的 `ownerTeam` 是否在身份的 `teamIds` 內判定。綁團隊而非綁建立者：人會離職換組，綁個人會讓技能失去維護者，且 `packages` 表沒有建立者欄位。

`employee` 角色**不落庫**：沒有任何角色即視為員工。API enum 仍保留該值以免破壞既有呼叫，但不作為權限判斷依據。

審核權只看 `reviewer` 角色，**不再讀 `reviewer_assignments` 的類型＋分類範圍**。原因是 `category` 為自由文字（實際資料同時存在 `backend` 與 `後端`、`DBA` 與 `部署`），拿無約束的欄位當權限條件，結果是指派了卻匹配不到任何技能。該表與下方三個端點暫時保留，待實跑確認後另行移除。審核獨立性改由作者迴避單獨保證。

非 `development` 環境若未配置正式 IdP，身份模組會使用 `DisabledIdentityProvider` 並拒絕登入。前端需為此提供明確的錯誤狀態，而非停在無限 loading。

`GET /api/admin/reviewer-candidates` 只回傳有效身份的 `uid`、`displayName` 與 `teamIds`，並僅允許 global `platform_admin`。審核者選單提交 `uid`；姓名與團隊只用於辨識，不得由前端虛構身份。`packageType` 與 `category` 必須由 Catalog 真實套件資料產生聯動選項。

### 稽核與遙測

| 方法 | 路徑 | 用途 | 使用頁面 |
|---|---|---|---|
| GET | `/api/audit/logs` | 稽核日誌 | 管理後台 |
| POST | `/api/telemetry/report` | 遙測上報 | 由生成腳本呼叫 |

`POST /api/telemetry/report` 是安裝腳本的上報入口，不由瀏覽器呼叫。安裝頁只需展示將上報的欄位，供使用者在執行前檢視。

## 安裝頁的資料來源

安裝頁是執行前預覽，不觸發任何寫入。四個區塊的來源如下：安裝命令全文與影響資源來自套件詳情；所需權限來自版本的殘留副作用聲明；將上報的遙測欄位是 Task #7 固定的十一欄白名單，前端以靜態清單呈現，不從後端查詢。

下載按鈕指向 `GET /api/packages/:packageId/versions/:version/download`。

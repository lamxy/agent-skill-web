# 环境工具极简规约

当环境中存在以下“工具选择”表格中列出的首选工具，并且满足触发条件时，必须优先使用表格中的首选工具。同时，在首选工具可用的情况下，**严格禁止**使用“默认工具/兜底工具”。

若首选工具调用失败，允许重试最多 **2 次**；连续 2 次失败后，必须主动上报用户，由用户决定是否使用对应行"默认工具/兜底工具"继续执行任务。**不得静默降级。**

> 识别到首选工具未安装时：提醒用户，并等待用户指示是否使用对应行「默认工具/兜底工具」列的工具继续执行。

**环境分流：**
- **VS Code Chat/Agent 环境**：优先使用 `grep_search`、`file_search`、`semantic_search` 等 VS Code 优化工具；本规约的 rg/sg 仅作为终端命令补充，不覆盖 VS Code 工具。
- **Claude Code CLI 环境**：本规约完整生效，rg/sg 为首选。

## 工具选择

**触发条件：** 任务需要在代码库中执行文本搜索、正则搜索或语法结构查询，且运行环境为 CLI（WSL/Linux/macOS 终端）时，本节工具规约完整生效。

| 场景 | 首选工具 | 默认工具/兜底工具 (禁止静默使用) |
|------|------|----------|
| 文本/正则/字符串/TODO 搜索 | rg | grep / find |
| 语法结构查询（函数签名、调用链、Hook 模式等） | sg（ast-grep） | rg / grep (因多行结构易误匹配) |
| 单行关键字 + 结构双重确认 | ① rg 定位文件；② sg 验证结构 | 禁止跳过任一步骤，禁止两者互相替代 |

语法上下文敏感时优先 sg，避免文本搜索的误匹配噪音。

**工具可用性判断：**
- 执行 `which rg` / `which sg` 检测；未找到须提醒用户安装，等待指示后才可回退兜底工具，不得静默使用兜底工具。

> sg（ast-grep）支持语言：Go、TypeScript/JavaScript、Python、Rust、Java、C/C++、Ruby 等主流语言；对不在支持列表内的语言（如 DSL、模板文件），回退 rg 并标注"语法结构不可验证"。

## LSP 语言服务工具

**触发条件：** 任务属于符号级代码操作（查引用、跳转定义、重命名、诊断），且目标语言的 LSP 服务器可用时，必须优先使用 LSP 工具，禁止以文本搜索代替。

| 场景 | 首选工具 | 兜底（LSP 不可用时） |
|------|------|----------|
| 查符号所有引用 | VS Code: `vscode_listCodeUsages`<br>CLI: LSP find-references | rg（须标注：存在同名文本误报风险） |
| 跳转/定位符号定义 | VS Code: `vscode_listCodeUsages`<br>CLI: LSP go-to-definition | sg 结构查询 |
| 符号重命名 | VS Code: `vscode_renameSymbol`<br>CLI: LSP rename | **禁止**用 sed/find-replace 替代，必须上报用户 |
| 编译/类型/诊断错误 | VS Code: `get_errors`<br>CLI: `gopls check` / `tsc --noEmit` 等 | 直接运行对应编译器命令 |

**LSP 可用性判断：**
- **VS Code 环境：** 语言扩展提供 LSP，`vscode_listCodeUsages` / `get_errors` 直接可用；调用失败则上报用户。
- **Claude Code CLI 环境：** 执行 `which <lsp-binary>` 检测（常见：`gopls`、`typescript-language-server`、`intelephense`、`jdtls`）；未找到须提醒用户安装，等待指示后才可回退 sg/rg。

> 文本/正则/批量模式搜索仍走 rg/sg（见上方工具选择表），不受本节约束。

## Token 节省原则（必须遵守）

- 先定位再读取：`rg -l "pattern"` 找到文件后再读内容，不直接 dump 全量结果
- 限制输出行数（仅限 rg）：PowerShell 用 `| Select-Object -First 20`；WSL/Linux 用 `| head -n 20`；sg 不截断管道，结果过多时收紧 pattern 或加 `--files-with-matches`
- 排除噪音：`rg --max-columns 120 --glob '!*.lock'`（根据项目类型按需扩展）
- ast-grep 精确查询：`sg run --pattern '...' --lang <lang>`；仅查路径加 `--files-with-matches`；结构化输出加 `--json=compact`
- 优先 `rg -c "pattern"` 做密度预判，再决定是否展开全量结果
- rg 匹配含空白的多词结构时用 `\s+` 替代空格：`rg "type\s+IFoo\s+interface"`；需要忽略大小写时加 `-S`
- 查接口实现优先从特征方法反查：`sg run --pattern 'func ($$$) MethodName() ReturnType { $$$ }' --lang go`，而非盲搜 struct 定义

<!-- 维护者注：新增工具时，在工具选择表格追加行（含禁用列），并在 Token 节省原则下添加对应约束；
     若该工具独立规约条目超过 3 条，单独拆出 env-<toolname>-min.md，本文件保留一行引用。 -->

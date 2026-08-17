# Downcity 工程设计与代码演进规范

> 状态：必须遵循
>
> 适用范围：Downcity 全仓库，包括 SDK、CLI、Server、Plugin、Shell、Sandbox、Service、UI 与文档
>
> 目标：把产品意图稳定地转化为边界清晰、复杂度可控、可以长期演进的代码
>
> 更新时间：2026-07-26

## 1. 这份规范解决什么问题

代码质量不只取决于某个函数是否正确，更取决于概念是否必要、职责是否放对位置、依赖方向是否稳定，以及系统变化时是否仍然容易理解。

Downcity 的工程目标不是追求最多的抽象、最强的限制或最通用的框架，而是：

> 用最少且语义准确的概念，建立明确的资源所有权、能力边界和生命周期，让系统在开放、稳定、安全与跨平台之间保持可解释的平衡。

本规范用于指导以下决策：

- 新能力应该属于哪个 package、对象和领域。
- 是否应该新增抽象、接口、上下文或中间层。
- Agent、Workspace、Session、Plugin、Shell 和宿主如何协作。
- 哪些逻辑应该跨平台，哪些差异必须下沉到平台 Adapter。
- 公开 API、类型、存储协议和文档如何演进。
- 遇到 Bug 时应该局部修补，还是重新整理错误的职责边界。
- 大型修改如何设计、迁移、验证和提交。

## 2. 设计决策的优先顺序

设计代码时，按照下面的顺序思考：

```text
产品意图
  → 领域职责
  → 所有权与生命周期
  → 依赖方向
  → 最小公开 API
  → 数据与失败语义
  → 具体实现
```

不能从“现有文件放在哪里”或“怎样少改几行”开始倒推架构。现有结构只能作为事实输入，不能自动成为未来设计的理由。

### 2.1 先问意图

每个能力都必须先用一句话说明它解决的真实问题。例如：

- Workspace 回答“这个 Agent 可以使用哪些项目资源”。
- Agent 回答“如何组织模型、工具、Plugin 和 Session”。
- Session 回答“连续对话如何排队、执行、持久化和恢复”。
- Shell 回答“命令和进程如何执行”。
- Sandbox Adapter 回答“如何在当前操作系统落实进程隔离”。

如果一个对象无法用一句稳定的话描述，它通常是职责混合、命名错误或尚无必要。

### 2.2 再确定所有权

所有状态和资源都必须有唯一、明确的拥有者。拥有者负责：

- 创建。
- 对外暴露必要能力。
- 维护状态不变量。
- 处理失败与恢复。
- 在生命周期结束时释放。

被多个对象使用不等于被多个对象拥有。共享使用必须通过稳定引用、只读视图或明确接口完成，不能复制出多个事实源。

### 2.3 最后才选择实现

类、接口、事件、数据库、JSONL、HTTP、RPC 和 Adapter 都只是实现手段。不要因为某种模式常见，就先创建模式再寻找用途。

## 3. 核心工程哲学

### 3.1 意图优先于目录

代码归属由业务意图决定，不由历史位置、导入便利性或当前调用者决定。

判断一个能力属于哪个模块时，使用以下问题：

1. 它维护的状态是谁的状态？
2. 它失败时应该由谁处理？
3. 它的生命周期跟随谁？
4. 如果更换调用方，它的职责是否仍然成立？
5. 它是否迫使下层理解上层业务？

例如，多 Agent 管理、daemon、全局配置和平台账号属于 CLI/City 控制面，不属于单 Agent SDK。即使 Agent 包过去已经实现这些能力，也应该迁回真正的拥有者。

### 3.2 最少概念原则

新增一个公共概念的成本远高于新增一个私有函数。每个新概念都会带来：

- 新的心智负担。
- 新的依赖路径。
- 新的生命周期问题。
- 新的扩展与兼容预期。
- 新的文档和测试责任。

只有同时满足以下条件时，才考虑新增公共抽象：

- 它表达独立且长期稳定的业务意图。
- 它拥有真实状态、资源或策略。
- 它能消除重复规则，而不是只转发调用。
- 删除它会让多个模块重新产生同一种复杂度。

没有独立语义的 `Host`、`SystemHandler`、`Manager` 或 Service Container 不应存在。单纯把多个服务装进一个对象，不构成合理抽象。

### 3.3 组合优于万能抽象

优先组合职责明确的对象：

```text
Workspace = ProjectPath + Files + Env + WorkspaceTools + Shell? + DataRoot

Agent = Identity + Model + Instruction + Plugins

AgentWorkspace = Agent.enter(Workspace) + Storage + Tools + Sessions + Context

Session = State + Queue + Messages + Composer + Executor + Approvals

Shell = Command/Process Protocol + Sandbox Adapter
```

不要创建一个可以访问所有资源、转发所有方法的万能对象。万能对象会隐藏依赖，使测试、替换、权限分析和生命周期管理变得困难。

### 3.4 高内聚、低耦合不是接口数量

解耦的目标是让变化被限制在正确的边界内，不是让每两个类之间都增加一层接口。

好的解耦表现为：

- 模块只知道完成职责所需的最少信息。
- 上层组合下层，下层不反向理解上层业务。
- 平台变化不会进入 Agent 和 Session。
- 存储实现变化不会进入 Executor。
- Plugin 变化不会修改 Workspace 的职责。

如果一个接口只被一个实现使用、没有形成清晰边界，也没有测试替换价值，可以直接依赖具体实现。

### 3.5 单一事实源

同一状态只能有一个权威来源。

典型规则：

- SessionMessages 是会话消息的 canonical source。
- Workspace 持有 Workspace env，Agent 不复制另一份 env。
- PluginRegistry 持有已注册 Plugin，Agent 只组合和暴露。
- SessionStore 基于 AgentWorkspaceStorage 的私有 FileSystem 实现持久化，不写入项目目录。
- 运行中状态通过事件或 getter 投影，不能在 Context 中复制后长期漂移。

缓存可以存在，但必须明确：

- 缓存从哪个事实源生成。
- 何时失效。
- 是否可以重建。
- 崩溃后是否影响正确性。

### 3.6 生命周期必须闭合

创建资源的对象必须负责关闭资源，除非 API 明确转移所有权。

需要明确管理的资源包括：

- 子进程和 PTY。
- Sandbox。
- 文件锁和数据库连接。
- Timer、Schedule 和后台 Worker。
- 网络 Server、Socket 和订阅。
- Plugin lifecycle。
- 日志缓冲区。

每个长期对象都应回答：谁创建我、谁等待我 ready、谁 dispose 我、dispose 失败时如何收口。

### 3.7 状态变化发生在检查点

运行中的系统不能让配置在任意代码行隐式漂移。

模型、Plugin、env、instruction、compact 和审批状态等变化，应在明确的边界提交，例如：

- Session Turn 开始。
- Model Step 结束。
- Queue command 被消费。
- Plugin execution lease 释放。
- 持久化事务提交。

这样可以保证一次执行看到的上下文一致，也可以解释变化何时生效。

## 4. Downcity 的领域边界

### 4.1 Workspace 是资源容器

Workspace 统一持有一个 Agent 可以使用的项目资源：

- 规范化后的项目根目录。
- Rooted FileSystem。
- 文件与搜索工具。
- Workspace env。
- 可选 Shell。
- 通用的私有存储 Provider；Provider 不理解 Agent、Session 或 Plugin 语义。

Workspace 不负责：

- 模型调用。
- Session 编排。
- Plugin 业务。
- daemon 和多 Agent 管理。
- 用户级全局配置。

Workspace 必须有稳定 ID。Agent 定义不保存 Workspace 绑定；宿主在一次具体执行开始时创建 Workspace，并通过 `agent.enter(workspace)` 得到 AgentWorkspace。一个 Agent 可以同时进入多个 Workspace，各自的 Session、Shell、env、日志与 Plugin 状态必须隔离。项目目录只承担真实项目文件与命令 cwd，不承担 Downcity 运行状态。

### 4.2 Agent 是单 Agent 组合根

Agent 持有：

- 稳定身份。
- 模型和 instruction。
- Agent 级自定义工具。
- 唯一 PluginRegistry。
- Agent 自身长期运行状态。

Agent 不持有单一 Workspace。`AgentWorkspace` 是 Agent 进入一个 Workspace 后的执行边界，持有该项目的工具、Session、PluginContext 和项目生命周期资源。

每个本地 AgentWorkspace 的内部运行状态统一保存在：

```text
~/.downcity/agents/<agent_id>/workspaces/<workspace_id>/
```

该目录包含 Session、日志、Schedule、Plugin 状态与缓存。`AgentWorkspace.data_path` 和 `PluginContext.data_path` 指向同一个 AgentWorkspace 数据根；`PluginContext.workspace_path` 始终只指向真实项目。

Agent 不负责：

- 自动选择平台 Sandbox。
- 管理全局 Agent registry。
- 管理 daemon、HTTP/RPC Server 生命周期。
- 持有 City 控制面配置。
- 暴露 Plugin 专用内部上下文给宿主。

宿主依赖 Agent facade；PluginContext 只用于向 Plugin 投影最小且稳定的执行能力。

### 4.3 Session 是连续执行边界

Session 负责：

- 输入排队。
- Turn 与 Step 编排。
- 消息和 Metadata 持久化。
- system snapshot。
- 审批、停止、压缩和恢复。
- 对外发布 Mutation。

Session 不负责平台差异，也不直接拼接物理存储路径。

### 4.4 Plugin 是 Agent 能力扩展

Plugin 可以提供：

- Tool Action。
- Hook。
- System 内容。
- Lifecycle。
- HTTP Route 描述。

Plugin 通过 PluginContext 使用 Agent 内核允许的能力。PluginContext 是内部能力投影，不是宿主控制面，也不是 Agent 全量状态容器。

所有 Plugin 都由 Agent 注册。Action、Hook、System、Availability 调用始终获得当前 Workspace 的 PluginContext；Plugin 自己决定是否读取其中的 Workspace 能力。框架不定义 workspace plugin、scope 或 requirements。

Plugin 生命周期分为 Agent 级 `start/stop` 和可选的 Workspace 级 `enter_workspace/leave_workspace`。实现哪些钩子由 Plugin 自己决定，不构成 Plugin 分类。

### 4.5 Agent 定义的本地事实源

本地 Agent 定义保存在 `~/.downcity/agents/<agent_id>/`：

- `agent.json`：身份、版本、默认执行配置和以 Plugin ID 为键的注册引用。
- `SOUL.md`：Agent 跨 Workspace 复用的主体指令。

Plugin 以全局稳定 ID 为身份，定义与配置保存在 `~/.downcity/plugins/<plugin_id>/`：

- `config.toml`：Plugin 自己拥有的明文 profile 配置，目录权限为 `0700`、文件权限为 `0600`。
- `plugin.json`：仅第三方 Plugin 使用，是静态定义、配置 JSON Schema、默认配置与安装来源信息的唯一事实源。
- `package.json`：仅第三方 Plugin 使用，声明 `"type": "module"` 并建立明确的 ESM package 边界。
- 自包含入口：仅安装 `plugin.json.entry` 指向的单个文件；源码、TypeScript 配置和构建工具配置不进入 Plugin ID 目录。

Agent 通过 `agent.json` 选择 Plugin 与可选 profile。Plugin profile 可以包含渠道、账号、端点等 Plugin 自己定义的结构；配置 Schema 与默认值由 Plugin definition 拥有，TOML 只保存 profile 值，TypeScript 类型由 Plugin 代码独立维护。框架不定义 Binding、Resource 或 Installation 持久化领域。内置与第三方 Plugin 都按稳定 ID、JSON Schema 与 Plugin constructor 进入 Loader；第三方入口通过 `plugin` 直接导出 constructor，不增加公开工厂协议，Definition ID 同时是目录名和 Registry key。

`downcity.db` 继续保存 Workspace 索引、平台设置和 Token，不保存 Agent 或 Plugin 配置，也不保存 Agent-Workspace 绑定。Workspace 与平台设置以明文 JSON 保存，本地隔离依赖数据库文件权限。

Agent 在 Workspace 中执行产生的本地状态保存在 `~/.downcity/agents/<agent_id>/workspaces/<workspace_id>/`。Session ID 在 AgentWorkspace 内唯一，Session metadata 必须同时记录 `workspace_id` 与 `agent_id`。项目目录中不得创建 `<project>/.downcity`，也不进行旧目录兼容读取或迁移。

Workspace 只保证底层文件和 Shell 安全边界，不为 Plugin 的业务行为负责。Plugin 的业务权限、账号、网络访问与语义校验由 Plugin 或宿主管理。

### 4.5 Shell 只负责命令和进程

Shell 提供统一的命令与长期进程协议，并与 Sandbox Adapter 协作。

Shell 不应该吸收：

- 通用文件系统。
- Session 历史。
- SessionStore。
- 模型、Plugin 或业务配置。
- 所谓全能 `system_handler`。

文件 Tool 和 Shell Tool 都属于 Workspace 能力，但它们是不同执行通道，不能因为都访问本机而合并为同一个 God Object。

### 4.6 控制面属于 CLI/City

以下能力属于宿主控制面：

- 多 Agent registry。
- daemon 启停和身份确认。
- 用户级路径与配置。
- 模型目录、账号和密钥。
- HTTP/RPC Server 装配。
- 平台 Sandbox Package 选择。

`@downcity/agent` 应保持为可以独立嵌入任意 Node.js 应用的单 Agent SDK。

## 5. 跨平台设计规范

### 5.1 默认相信 Node.js 的跨平台能力

常规能力优先使用 Node.js 标准 API：

- 文件和目录：`node:fs`。
- 路径：`node:path`。
- 系统信息：`node:os`。
- 网络：标准 `fetch`、HTTP 和 WebSocket。
- Timer、AbortSignal 和事件。
- 普通子进程启动。

不要为 Node.js 已经统一的能力增加 macOS、Linux、Windows 三套实现。

### 5.2 只抽象真实的平台差异

以下能力可以进入平台 Adapter：

- macOS Seatbelt、Linux Bubblewrap、Windows MXC/SRT。
- Unix PTY 与 Windows ConPTY。
- Signal、进程组与 Windows Job Object。
- ACL、reparse point 和平台凭据系统。
- 系统服务管理。

平台判断应尽可能出现在依赖树底部。Agent、Session、Message、Store 和 Plugin contract 不得出现无必要的平台分支。

### 5.3 平台包独立安装

原生 Sandbox 适配必须拆分为独立 package，由宿主按当前系统选择和注入。核心 Agent/Shell 包不能直接捆绑全部平台依赖。

目标使用方式：

```ts
const workspace = new Workspace({
  id: "project",
  path: process.cwd(),
  shell: new Shell({ sandbox: platform_sandbox }),
});
```

更换操作系统只替换 `platform_sandbox`，不改变 Agent 业务代码。

## 6. 安全与开放性的平衡

### 6.1 安全保证下限，不接管全部决策

Downcity 的安全边界负责防止意外逃逸、路径混乱和未审批的高风险执行，但不应把 Agent 限制成无法完成真实工作的封闭系统。

安全策略分为三层：

1. 内核下限：路径规范化、Workspace rooted access、输入校验、审计和生命周期收口。
2. 宿主策略：是否启用 Shell、选择何种 Sandbox、审批模式和外部凭据。
3. Agent 决策：在宿主授予的能力内选择何时调用工具和执行任务。

### 6.2 权限与能力分开

“系统能够做什么”与“当前调用是否允许做”是两个问题。

- Capability 由 Workspace、Tool、Plugin 和 Shell 提供。
- Policy 由宿主、Sandbox、审批和 Plugin 业务规则决定。

不要为了权限控制复制一套文件系统或创建无业务意义的 RuntimeFileSystem。也不要把所有能力塞进 Shell，只因为 Shell 可以访问系统。

### 6.3 unrestricted 必须显式

开放高权限能力时必须满足：

- 调用方显式请求。
- 原因可记录。
- 宿主可以审批或拒绝。
- 行为进入审计。
- 失败时默认不执行。

安全不能依赖提示词或 Agent 自觉，必须由执行边界落实。

## 7. 公开 API 规范

### 7.1 公开面必须最小

package 根入口只导出用户真正需要并承诺维护的能力。内部 router、runtime runner、路径 helper 和装配细节不应因为测试方便而进入根导出。

判断是否公开时需要回答：

- 用户是否需要直接调用它？
- 它是否具有稳定语义？
- 是否存在更高层 facade？
- 公开后是否迫使用户理解内部装配？

### 7.2 命名统一

Downcity 自有的变量、函数、方法、参数和协议字段统一使用 `snake_case`。

- 类型和类使用 `PascalCase`。
- 常量可以使用 `UPPER_SNAKE_CASE`。
- 第三方协议字段保持第三方原始命名，不能擅自改写。
- HTTP、RPC、持久化结构只要由 Downcity 定义，也必须使用 `snake_case`。

公开命名应由自动测试守护，不能只依赖人工搜索。

### 7.3 不保留无价值的兼容层

本项目处于直接演进阶段。API 设计发生变化时：

- 直接迁移所有仓库内调用方。
- 删除旧类型、旧方法和旧导出。
- 更新测试、模板和用户文档。
- 不增加 deprecated alias、双字段解析或永久兼容分支。

只有明确存在独立发布节奏或外部协议迁移窗口时，才设计版本化兼容方案。

### 7.4 Context 只投影必要能力

Context 不应该成为隐式 Service Container。

新增 Context 字段前必须确认：

- 使用者是否真的需要它。
- 是否可以通过更明确的 facade 完成。
- 字段是动态 getter 还是稳定快照。
- 是否暴露了不属于该使用者的控制能力。

PluginContext 只服务 Plugin；宿主直接依赖 Agent，不获取 PluginContext。

## 8. 数据、存储与恢复

### 8.1 Store 是领域能力，不是第二个资源容器

Store 基于 AgentWorkspaceStorage 提供的私有 FileSystem 原子能力实现 Agent/Session 结构化持久化。Store 与 Workspace 的关系是：

```text
Workspace 提供项目资源与通用私有存储 Provider
  → Agent.enter() 打开 agents/<agent_id>/workspaces/<workspace_id> 作用域
  → AgentWorkspace 创建 AgentWorkspaceStorage 与 LocalSessionStore
  → SessionStore 定义 Session 集合存储语义
  → SessionDataStore 定义单个 Session 存储语义
  → MessageStore 定义消息提交与恢复语义
```

Store 只能使用 AgentWorkspaceStorage，不能使用项目 FileSystem。项目 Tool 不能读取或修改 Session、instruction、日志和 Plugin 私有状态；需要内部持久化能力的 Plugin 使用 `PluginContext.data_path` 或 `data_files`。

### 8.2 持久化必须服务于恢复

不能只保存最终展示结果。需要根据恢复目标保存：

- canonical messages。
- 运行中草稿。
- Metadata 与版本。
- system snapshot。
- action 和 approval 状态。
- compact segment 与 summary。

每一种持久化状态都必须说明崩溃发生在写入前、中、后时如何恢复。

### 8.3 写入必须具备明确原子语义

涉及状态迁移时，优先使用：

- 临时文件加原子替换。
- sequence/revision。
- 文件锁或数据库事务。
- 幂等提交。
- 可重建索引。

不能让多个模块各自用“先读后写”维护同一份关键状态。

## 9. 失败处理与稳定性

### 9.1 失败必须属于正确边界

- 模型 Provider 错误由 Executor/恢复策略处理。
- Message 写入失败由 SessionMessages 暴露并阻止伪完成。
- Plugin lifecycle 失败由 Agent 内部运行时隔离和记录。
- Shell/Sandbox 启动失败由 Shell 返回明确错误，不能静默降级为 unrestricted。
- daemon 身份不一致由 CLI 拒绝终止进程。

不要在错误的上层使用大范围 `catch` 隐藏下层不变量破坏。

### 9.2 区分业务失败与系统失败

Plugin action 返回 `success: false` 是业务结果，不等于 Plugin runtime 损坏。只有 lifecycle、协议或执行基础设施失败，才应该改变 Plugin 健康状态。

同理，用户取消、审批拒绝、超时和 Provider 错误必须保持不同语义，不能全部压成普通字符串异常。

### 9.3 不允许危险的静默回退

以下回退默认禁止：

- Sandbox 不可用时转 unrestricted。
- 指定模型不可用时静默换模型。
- Store 写入失败后仍报告成功。
- 无法验证 daemon 身份时仍发送 kill。
- 路径无法确认时回退到当前进程目录。

回退只有在结果等价、可观察且不会削弱安全边界时才允许。

## 10. 代码组织规范

### 10.1 文件表达单一职责

文件名、导出能力和模块注释必须能共同说明该文件的职责。

- 每个模块必须有文件级注释。
- 关键设计节点使用中文注释解释“为什么”。
- 不用注释重复代码表面行为。
- 模块达到约 800–1000 行时必须审视并按职责拆分。
- 类型集中在 `types/`，每个字段必须有详细注释。
- 避免动态导入，依赖关系应尽可能静态可见。

### 10.2 拆分按职责，不按代码长度平均切块

合理拆分示例：

- codec、storage、runtime、policy、factory。
- query、command、lifecycle。
- protocol type 与 implementation。

错误拆分示例：

- `Utils1.ts`、`Utils2.ts`。
- 只为减少行数创建没有语义的 helper 文件。
- 把同一个状态机拆到多个互相修改内部状态的模块。

### 10.3 避免过早通用化

只有出现稳定重复模式时才提取通用能力。两个外形相似但业务不变量不同的流程，不应为了复用而共享抽象。

优先允许少量清晰重复，也不要创建难以解释的泛型框架。

## 11. Bug 修复与重构方法

### 11.1 先定位不变量被谁破坏

诊断 Bug 时依次确认：

1. 期望保持的不变量是什么。
2. 哪个对象应该维护这个不变量。
3. 当前状态为什么能绕过它。
4. 问题是局部实现错误，还是职责放错位置。
5. 修复后如何自动防止复发。

不要从报错行直接添加条件分支。报错行通常只是错误状态最终暴露的位置。

### 11.2 优先修正模型，不做补丁堆叠

出现以下信号时，应考虑重构：

- 同一字段在多个对象同步。
- 同一平台判断分散在多个业务模块。
- 新需求总要修改一个无关的 Manager/Context。
- 为绕开生命周期问题不断增加 flag。
- 一个 Bug 修复需要同时添加多个 fallback。
- 测试必须深入修改私有状态才能构造场景。

重构目标是删除错误概念或恢复正确边界，而不是简单把代码移动到新目录。

### 11.3 大改先设计再实施

可能影响多个模块、公开 API 或持久化协议时，先输出设计方案并确认：

- 当前问题与根因。
- 目标心智模型。
- 职责和依赖变化。
- 删除、新增和迁移的公开能力。
- 数据与失败语义。
- 测试和文档范围。
- 明确不做的内容。

确认后一次完成完整迁移，不留下永久双轨结构。

## 12. 测试与验证规范

### 12.1 测试不只验证结果

关键测试需要覆盖：

- 边界：路径、权限、平台、package 和 Context。
- 不变量：唯一事实源、顺序、原子提交和身份确认。
- 生命周期：ready、running、stop、dispose 和崩溃恢复。
- 失败语义：拒绝、取消、超时、业务失败和系统失败。
- 公开 API：导出、命名、字段和用户示例。

### 12.2 测试真实公开入口

package 行为测试优先使用编译后的公开入口，确保测试内容与用户安装后的行为一致。内部算法可以直接测试源码模块，但不能因此把内部能力暴露到根入口。

### 12.3 自动守护架构规则

适合自动化的规范必须进入测试或静态检查，例如：

- 公开 API 命名。
- 根导出范围。
- package build。
- 跨 package typecheck。
- 平台 package 安装边界。
- 文档代码示例中的旧 API 扫描。

人工评审应集中在意图和边界，而不是重复检查机器可以判断的格式。

### 12.4 验证顺序

推荐顺序：

```text
定向 typecheck
  → 定向单元/集成测试
  → 消费 package typecheck
  → 全仓 typecheck
  → Homepage build（用户文档变化时）
  → patch build
  → git diff --check
```

平台能力无法在当前系统验证时，必须明确记录，并交给对应平台 CI 验证，不能用本机模拟成功代替。

## 13. 文档规范

文档分为两类：

- `homepage/content/`：只写用户需要理解和调用的内容。
- `docs/`：写架构、工程决策、PRD、迁移和开发规范。

公开 API 或用户可见行为变化时，必须同步 Homepage。内部设计变化应同步相关架构文档，避免文档继续描述已经删除的对象和调用方式。

文档示例属于 API 测试的一部分。代码已经迁移但示例仍使用旧 API，视为迁移未完成。

## 14. 版本与提交规范

### 14.1 版本递增

package 公开能力、SDK API 或用户可见行为变化时，按影响范围运行 patch 脚本：

- Agent：`pnpm agent:patch:build`
- City：`pnpm city:patch:build`
- CLI：`pnpm cli:patch:build`
- 多 package：按实际影响范围显式指定，例如 `pnpm patch:build -- --city --services --database-d1`
- 仅验证：显式指定范围并使用 `pnpm patch:build -- --no-bump --city --services`

只有对外能力实际发生变化的 package 才递增版本。构建脚本可以自动补齐依赖 package 进行验证，但依赖被构建不代表它也需要递增版本。

不能手工只改版本号而跳过构建。

### 14.2 提交边界

一次提交应表达一个完整意图：

- 代码、测试、类型、文档和必要版本号一起提交。
- 只 stage 本次任务相关文件。
- 提交前执行 `git diff --check`。
- 提交后确认工作区没有遗漏本次文件。
- commit message 使用明确 scope 和行为，例如 `refactor(agent): clarify workspace ownership`。

## 15. 禁止的反模式

以下做法默认不接受：

- 为未来假设创建当前没有使用价值的公共抽象。
- 用 Host、Context、Manager 或 Service Container 隐藏真实依赖。
- 让 Shell 成为文件、存储、配置和系统能力的总入口。
- 在 Agent/Session 业务层散布操作系统判断。
- 复制状态并依赖多个模块保持同步。
- 为了向后兼容保留双 API、双字段和双执行路径。
- Sandbox 失败时静默降级。
- Store 写入失败后继续报告成功。
- 只修改实现而不迁移测试、模板和用户文档。
- 通过根导出暴露内部 helper 以方便测试。
- 通过新增布尔 flag 修复职责错误。
- 用全局字符串替换修改第三方协议字段。
- 用“以后可能需要”作为增加复杂度的唯一理由。

## 16. 设计评审清单

提交设计或代码前，逐项回答：

### 意图

- 这个能力解决的真实问题是什么？
- 是否能用一句话描述新增对象的职责？
- 这是当前需求，还是对未来的猜测？

### 边界

- 状态和资源由谁拥有？
- 生命周期跟随谁？
- 失败由谁处理？
- 下层是否被迫理解上层业务？
- 是否引入了没有独立语义的中间层？

### 数据

- 唯一事实源在哪里？
- 是否复制了可变状态？
- 写入是否原子、幂等、可恢复？
- 状态变化在哪个检查点生效？

### API

- 能否通过现有 facade 完成？
- 根入口是否保持最小？
- Downcity 自有命名是否全部 snake_case？
- 类型字段是否有详细注释？
- 是否完整删除了旧 API？

### 跨平台与安全

- Node.js 是否已经解决这个问题？
- 平台差异是否位于最底层 Adapter？
- 失败是否会削弱安全边界？
- 权限策略和能力实现是否解耦？

### 验证

- 是否覆盖正常、失败、取消和恢复路径？
- 是否测试真实 package 入口？
- 是否同步消费 package、模板和文档？
- 是否运行正确的 patch build？

## 17. 最终判断标准

一个好的 Downcity 设计通常具有以下特征：

- 用户只需要理解少量稳定概念。
- 每个对象都有明确意图和生命周期。
- 状态有唯一事实源。
- 依赖从组合层指向能力层，不反向渗透。
- 平台差异被限制在 Shell/Sandbox 等底层边界。
- 安全提供不可绕过的下限，同时保留宿主和 Agent 的决策空间。
- 公开 API 小、直接、一致，没有兼容残留。
- 失败可观察、可恢复，不通过危险回退掩盖。
- 新需求通常可以在所属领域内完成，而不需要修改全局容器。
- 删除错误概念后，代码总量和理解成本会一起下降。

最终原则可以归纳为：

> 从意图出发确定职责，以所有权建立边界，以最小组合控制复杂度，以单一事实源保证稳定，以底层 Adapter 隔离平台差异，以自动验证守住公开契约。

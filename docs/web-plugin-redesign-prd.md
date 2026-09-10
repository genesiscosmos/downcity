# Web Plugin 重设计 PRD

## 1. 产品意图

WebPlugin 为 Agent 提供受控的联网能力：发现和读取公开信息、使用页面原生工具、在必要时操作浏览器，并将结果以可审计的结构化数据返回。

WebPlugin 是这些能力的唯一领域所有者。Agent、Workspace 和 PluginContext 只提供执行范围，不拥有 Web 服务。

## 2. 当前问题

当前 `search` 和 `open` 通过 `context.agent.web` 查找能力，但 City 创建的 Agent 句柄没有实际装配该字段，导致标准运行环境中这两个 Action 永远不可用。Semantic Browser Adapter 虽然已经导出，却没有正式的注入路径。

当前还存在以下边界问题：

- 浏览器配置、连接、控制器和 Session 语义混在一起。
- 主要动作仍依赖 CSS selector，模型上下文效率和稳定性不足。
- WebPlugin 的 system 文本要求审批，但代码没有统一副作用声明和审批边界。
- CDP 外部浏览器与 Provider 自有浏览器的释放语义不清晰。

## 3. 设计目标

- 删除 `PluginContext.agent.web` 与 `PluginWebServices`。
- Search、Document、Browser 全部由 WebPlugin 内部 Provider 提供。
- Provider 对 Agent 暴露稳定、最小、JSON-only 的协议。
- 支持本地、远程 CDP、托管浏览器和自托管浏览器，而不改变 Agent API。
- 优先支持 WebMCP 和 Accessibility Snapshot，降低 token 与 selector 脆弱性。
- 对副作用、网络访问、Session 隔离和资源释放提供明确语义。

## 4. 非目标

- 不在 WebPlugin 内实现第二套 Agent Loop。
- 不负责安装 Skill、发现 Skill 或读取 `SKILL.md`。
- 不固定绑定 Browserbase、Stagehand、Exa、Tavily 或任一模型供应商。
- 不把完整 Playwright、Browser、Page 或 Buffer 对象暴露给 Agent。

## 5. 用户可见能力

第一阶段公开 Action：

```text
web.search
web.open
web.browser.create_session
web.browser.observe
web.browser.act
web.browser.extract
web.browser.close_session
```

第二阶段增加：

```text
web.browser.webmcp_list
web.browser.webmcp_invoke
web.browser.semantic_act
web.browser.semantic_extract
```

所有结果必须是 JSON 可序列化对象，并包含 provider、请求范围、目标 URL 或 session_id、结果数据、warnings 和结构化错误（如有）。

## 6. 使用策略

```text
静态信息 → search/open
页面原生工具 → WebMCP
DOM 稳定 → Playwright + ref
需要自然语言或自愈 → Stagehand
纯视觉或 DOM 不可用 → Computer Use
```

提交、发送、购买、删除、上传、下载和权限变更等副作用必须由 Action 元数据声明，并在宿主审批后执行。

## 7. 验收标准

- WebPlugin 不再依赖 `context.agent.web`。
- 未配置某个 Provider 时，只有对应能力不可用，其他能力仍可用。
- Provider 可按构造参数注入，也可根据 City 配置惰性创建。
- 同一 Agent 的 Session 有明确所有权和隔离策略。
- City dispose、配置更新和连接断开都能释放或失效相关资源。
- 所有 Action 都有 schema、失败语义、审计日志和测试。

## 8. Desktop 默认体验补充

- `open` 默认使用无密钥的安全 Fetch Provider。
- Browser 默认由 WebPlugin 自动发现并启动本地 Chrome/Chromium，不要求用户手工配置 CDP。
- Search 可在 Web 配置页直接填写 Tavily 或 Exa Key，也可从 Global Env 解析。
- Firecrawl 作为复杂网页的可选 Document Provider。
- 配置读取不得向 Renderer 返回 API Key 明文；密钥清除必须是显式操作。

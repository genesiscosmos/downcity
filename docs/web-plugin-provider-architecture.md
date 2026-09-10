# Web Plugin Provider 架构

## 1. 总体边界

```text
PluginContext
  └── 只提供 agent/workspace/session/config/storage/abort_signal

WebPlugin
  ├── SearchProvider
  ├── DocumentProvider
  ├── BrowserPageToolProvider（WebMCP）
  ├── BrowserController
  └── BrowserTransport
```

`WebPlugin` 拥有 Provider 注册表、配置快照、Provider generation、Session 索引和生命周期。PluginContext 不保存 Web 服务端口。

## 2. 核心协议

```ts
interface WebSearchProvider {
  readonly name: string;
  search(input: WebSearchInput): Promise<WebSearchResult>;
  dispose?(): Promise<void>;
}

interface WebDocumentProvider {
  readonly name: string;
  open(input: WebOpenInput): Promise<WebOpenResult>;
  dispose?(): Promise<void>;
}

interface BrowserProvider {
  readonly name: string;
  create_session(input: BrowserCreateSessionInput): Promise<BrowserObservation>;
  observe(input: BrowserObserveInput): Promise<BrowserObservation>;
  act(input: BrowserActInput): Promise<BrowserObservation>;
  extract(input: BrowserExtractInput): Promise<BrowserExtractResult>;
  close_session(input: BrowserCloseSessionInput): Promise<void>;
  dispose(): Promise<void>;
}
```

语义动作是可选能力，不应强迫所有浏览器实现依赖模型：

```ts
interface SemanticBrowserProvider extends BrowserProvider {
  semantic_act(input: BrowserSemanticActInput): Promise<BrowserObservation>;
  semantic_extract(input: BrowserSemanticExtractInput): Promise<BrowserExtractResult>;
}
```

## 3. 装配方式

运行时对象通过构造参数注入，持久化配置只保存 JSON：

```ts
new WebPlugin({
  search_provider,
  document_provider,
  browser_provider_factory,
});
```

City 配置只描述可重建的配置：

```ts
{
  search_provider: "auto" | "tavily" | "exa" | "disabled",
  document_provider: "fetch" | "firecrawl" | "disabled",
  browser_provider: "local" | "cdp" | "disabled",
  cdp_url: "..."
}
```

Desktop 允许在 Plugin Config 中写入 API Key，同时支持 Global Env。配置读取只返回
`*_configured` 状态，不把明文传给 Renderer；空输入保留旧值，显式清除才删除。当前本地
配置尚未接入系统钥匙串，因此界面必须明确存储边界。Plugin Config 中的 Key 优先于
Global Env。

## 4. 所有权与作用域

- WebPlugin 拥有 Provider。
- 默认 `FetchDocumentProvider` 无需配置；默认 `LocalBrowserProvider` 自动发现并启动本地 Chromium。
- BrowserProvider 拥有连接和它创建的 Page/Session。
- Browser Session 的稳定键至少包含 `agent_id`、`workspace_id` 和 `session_id`。
- Session 不得被其他 Agent 或 Workspace 直接使用。
- 外部 CDP Provider dispose 关闭自己创建的 Page，并通过 Playwright 的 CDP 关闭语义断开客户端 transport，不接管用户已有 Page 或浏览器进程。
- 自行启动浏览器的后续 Transport 必须显式声明 ownership，并负责关闭自己创建的进程。
- LocalBrowserProvider 使用 Plugin 私有目录中的持久 profile，只终止自己启动的进程。

## 5. Observation 协议

浏览器观察应从整页正文升级为：

- 页面 URL、标题和 generation。
- Accessibility Snapshot。
- 稳定元素 ref 和元素语义信息。
- 可选文本、截图和 snapshot diff。
- 当前页面的 untrusted-content 标记。

ref 只在当前 generation 有效。导航、页面刷新或 DOM 重大变化后必须失效，Action 应返回要求重新 observe 的错误。

## 6. WebMCP 与降级

浏览器页面存在 WebMCP 工具时，先列出并校验工具 schema，再由 WebPlugin 调用。页面提供的描述和返回值都视为不可信数据；页面声明的 read-only 不能替代宿主审批。

没有 WebMCP 时使用 Accessibility Snapshot；ref 操作失败时可转 Stagehand；DOM 不可用时才转 Computer Use。

## 7. 错误与安全

所有 Provider 错误都应转换为稳定结构：

```text
code、stage、provider、retryable、message、request_id
```

必须执行：

- 只允许 HTTP(S) 和明确允许的 CDP 协议。
- 对重定向目标重新执行 SSRF 和域名策略检查。
- 限制响应体、正文、截图和提取结果大小。
- 脱敏 URL 中的认证信息、token、查询参数和 browser id。
- 对副作用 Action 强制经过 Interaction/Approval 端口。
- 对每个 Action 记录 provider、scope、耗时、结果状态和错误阶段。

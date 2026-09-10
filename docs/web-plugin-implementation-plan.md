# Web Plugin 实施计划与验收

## 阶段一：修正职责边界（已完成）

- 删除 `PluginContext.agent.web` 和 `PluginWebServices`。
- 在 `WebPlugin` 内增加 SearchProvider、DocumentProvider 的注册和调用。
- 保留 Playwright/CDP 作为首个 BrowserProvider。
- 增加 provider 未配置时的 availability 结果，避免把不可用 Action 当成可用能力。
- 补齐 WebPlugin 集成测试和配置刷新测试。

验收：search/open 不再访问 Agent Context；注入 mock Provider 可独立测试；未配置浏览器不影响搜索和文档读取。

## 阶段二：统一浏览器协议（核心已完成）

- 已引入 Accessibility Snapshot、交互元素 ref 和 observation generation。
- 已让 `browser_act` 优先接受 ref，selector 作为高级确定性输入。
- 增加 snapshot diff、页面变化和 stale ref 错误。
- 明确 BrowserTransport 与 BrowserController 的分层。
- 已核对外部 CDP 连接的 dispose ownership：当前 Playwright `connectOverCDP` 的关闭路径断开 transport，并由专项测试保证不关闭默认 Context 和既有 Page。

验收：同一页面的观察和动作可回放；旧 ref 会稳定失败；dispose 不关闭外部用户已有 Page 或默认 Context。

## 阶段三：接入 WebMCP 与语义 Provider

- 实现 WebMCP 工具枚举、schema 校验和调用。
- 将 Stagehand Adapter 接入 BrowserProvider 装配路径。
- 将 Computer Use 限定为显式启用的视觉 fallback。
- 为所有页面工具增加 untrusted-content 和副作用审批标记。

验收：WebMCP 优先于 DOM；Stagehand 只在显式配置后出现；Computer Use 不接触 Playwright 对象。

## 阶段四：接入 Web Data Provider（基础能力已完成）

- 已实现 Exa SearchProvider。
- 已实现 Tavily SearchProvider。
- 已实现 Firecrawl DocumentProvider。
- 已提供受限的内置 FetchDocumentProvider 作为无密钥默认实现。
- 已增加超时、跳转次数、响应大小、SSRF 和凭据脱敏边界。
- Crawl、统一重试和引用证据协议留在后续增量中。

验收：Provider 可替换；结果包含来源、URL、标题、正文、证据和 warnings；网络错误不会泄漏秘密。

## 阶段五：浏览器运行环境（本地已完成）

- 已实现本地 Chromium 自动发现、独立进程、持久 profile 和 CDP 装配。
- Desktop 默认使用 Local Chrome，不再要求用户手工启动 9222。
- 增加 Browserbase Transport。
- 增加 Steel 自托管 Transport。
- 评估 Browserless 和 Lightpanda，不把其专有能力写入核心协议。

验收：更换运行环境不修改 Agent Action API；Session、认证状态和资源所有权语义保持一致。

## Desktop 配置体验（已完成）

- Search、Document、Browser 按能力分区配置。
- API Key 使用密码输入，只写入、不回显，可显式清除。
- 每个能力提供保存后真实测试。
- 仍支持 Global Env，Plugin Config 的 Key 优先。

## 必须建立的基准测试

- 静态官方文档读取和引用。
- JS 渲染、分页、iframe、Shadow DOM。
- 登录态 SaaS 查询，但不执行提交副作用。
- WebMCP 工具发现和调用。
- selector 变化、自愈和 stale ref。
- Canvas、地图、拖拽和验证码阻塞识别。
- Prompt injection 页面隔离。
- 10/100/1000 并发下的冷启动、P50/P95、失败恢复和成本。

## 提交前检查

- 只修改本任务相关文件。
- 若公开 API 发生变化，运行 `@downcity/plugins` 对应 patch/build 流程。
- 补跑 plugins typecheck、WebPlugin 测试和受影响的 City Plugin 测试。
- 更新 `homepage/content/plugins-docs/zh/builtins/web.mdx` 与英文文档。
- 使用明确作用域的 commit message，例如 `feat(plugins): redesign web provider boundary`。

# Web Plugin 市场调研与选型结论（2026）

> 调研日期：2026-09-09
>
> 范围：AI Agent 的 Web 搜索、网页读取、浏览器自动化、语义浏览器、Computer Use 与浏览器基础设施。

## 1. 结论摘要

市场已经分化为多个专业层次，没有一个产品同时在搜索、内容抽取、浏览器交互和运行基础设施上都最优。Downcity 不应选择一个“大而全”的 Web Agent 作为内核，而应建立自己的稳定协议，再按部署需求组合 Provider。

推荐组合：

```text
搜索：Exa 或 Tavily
网页读取：Firecrawl，必要时自托管 Crawl4AI
页面原生工具：WebMCP
确定性浏览器：Playwright + Accessibility Snapshot
语义浏览器：Stagehand
视觉兜底：Computer Use
浏览器运行环境：本地 Chromium/CDP、Browserbase 或 Steel
```

## 2. 主要项目比较

| 项目 | GitHub Stars（调研时） | 核心优势 | 适合位置 |
|---|---:|---|---|
| Firecrawl | 178k | Search、Scrape、Crawl、Map、Extract，输出 Markdown/JSON | Web Data Provider |
| Browser Use | 113k | 完整浏览器 Agent、长链路任务 | 高层 Task Provider，不做内核 |
| Crawl4AI | 82k | 开源、自托管、LLM 友好抓取 | 自托管 Document/Crawl Provider |
| agent-browser | 42k | Agent 友好的 CLI、snapshot/ref、低上下文 | Skill/CLI Adapter，协议借鉴 |
| Playwright MCP | 36k | Accessibility Snapshot 浏览器控制 | Observation/ref 设计借鉴 |
| Lightpanda | 35k | 面向 AI 和自动化的高性能浏览器 | 后续 Browser Transport |
| Stagehand | 24k | `act/observe/extract`、自愈、复杂 DOM | Semantic Browser Provider |
| Skyvern | 23k | 工作流型浏览器自动化产品 | 外部工作流系统 |
| Browserless | 13k | 成熟的浏览器 BaaS 和 REST/MCP | Browser Transport，注意许可证 |
| Steel Browser | 7.6k | Apache-2.0、自托管 Browser API | Browser Transport |
| Exa MCP | 5k | AI 原生搜索、内容获取、Research | Search/Research Provider |
| Tavily MCP | 2.4k | Search、Extract、Map、Crawl、Research | Search/Document/Research Provider |

Stars 只用于衡量生态关注度，不作为质量单一指标。

## 3. 选型判断

### 3.1 搜索

Exa 更适合语义搜索、相似内容、研究和结构化输出；Tavily 更像一站式 Agent Web API，覆盖搜索、抽取、Map、Crawl 和 Research。Downcity 应把两者都放在 Provider SPI 后面，不将任一供应商名称写入 Agent API。

### 3.2 网页读取

Firecrawl 在 JS 页面、PDF、表格、代理、批量抓取和 LLM-ready 输出方面最完整。Crawl4AI 是优秀的自托管 Python 方案，但更适合作为独立服务或 Sidecar，而不是直接成为 TypeScript 核心依赖。

### 3.3 浏览器控制

Playwright 仍是最好的底层浏览器控制库。需要升级的是 Downcity 的交互协议：模型优先使用 Accessibility Snapshot 和稳定元素 ref，而不是自行生成 CSS selector。selector 可以保留为高级接口。

### 3.4 语义浏览器

Stagehand 与 Downcity 的 TypeScript 技术栈和 `act/observe/extract` 语义最匹配。它应作为可选 Provider，不能接管 Downcity 的 Agent Loop、Session 或审批体系。

### 3.5 完整浏览器 Agent

Browser Use 的生态和长链路能力非常强，但它已经拥有 Agent Loop、模型、Prompt、工具、Session 和 Cloud Agent。直接嵌入会与 Downcity 的领域职责重叠，适合通过高层 `browser_task` Provider 接入，而不是实现 `BrowserProvider`。

### 3.6 运行基础设施

Browserbase 适合托管生产，Steel 适合 Apache-2.0 自托管，Browserless 生态成熟但商业使用需要审查 SSPL/商业许可。浏览器运行环境必须与浏览器控制器分离。

## 4. WebMCP 的影响

WebMCP 允许网页通过 `document.modelContext.registerTool()` 暴露页面自己的业务工具。它能复用网站已有的认证、状态和业务逻辑，比盲目 DOM 点击更可靠。

推荐执行优先级：

```text
WebMCP 页面工具
  → Accessibility Snapshot + ref
  → Stagehand 语义动作
  → Computer Use 视觉兜底
```

WebMCP 页面工具仍属于不可信输入；副作用声明、审批、返回值大小和内容隔离必须由宿主负责。

## 5. Product Hunt 信号

Product Hunt 的公开历史记录显示 Browser Use 与 Browser Use Cloud 在 2025 年获得明显关注；Browser Use 曾以“让 AI 控制浏览器”和“用提示控制网页”为核心卖点上榜。Firecrawl 的 `/extract`、`/search` 和 v2.5 也分别以结构化抽取、搜索加抓取和 Web Data API 获得产品发布关注。

这些记录证明市场对“Agent 可直接使用的 Web 能力”有明确需求，但不能代替真实基准测试。

## 6. 最终选型

Downcity 的长期方案不是单一产品，而是：

```text
Downcity WebPlugin
  ├── Exa/Tavily SearchProvider
  ├── Firecrawl/Fetch DocumentProvider
  ├── WebMCP BrowserPageToolProvider
  ├── Playwright BrowserController
  ├── Stagehand SemanticBrowserProvider
  ├── ComputerUse FallbackProvider
  └── LocalCDP/Browserbase/Steel BrowserTransport
```

正式实现前，必须用统一任务集测量成功率、P50/P95 延迟、上下文大小、模型调用次数、并发能力、失败恢复和成本。

## 7. 参考项目

- [Firecrawl](https://github.com/firecrawl/firecrawl)
- [Browser Use](https://github.com/browser-use/browser-use)
- [Crawl4AI](https://github.com/unclecode/crawl4ai)
- [agent-browser](https://github.com/vercel-labs/agent-browser)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Stagehand](https://github.com/browserbase/stagehand)
- [WebMCP](https://github.com/webmachinelearning/webmcp)
- [Exa MCP](https://github.com/exa-labs/exa-mcp-server)
- [Tavily MCP](https://github.com/tavily-ai/tavily-mcp)
- [Steel Browser](https://github.com/steel-dev/steel-browser)
- [Browserless](https://github.com/browserless/browserless)

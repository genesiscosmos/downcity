# 面向 Agent 的联网与浏览器能力方案调研

> 调研日期：2026-08-11
>
> 目标：评估主流的搜索、网页读取、浏览器自动化、Computer Use、云浏览器和登录态浏览器方案，并为 Downcity `web` plugin 选择底座。
>
> 说明：市场变化很快；以下结论以官方文档、官方仓库和官方产品页为主。用户提到的 “cloud Kitesurf” 对应 Cloudflare Kitesurf，“egolite” 对应 ego (lite)，“opencli” 对应 jackwener/OpenCLI。

## 一、执行摘要

结论先行：Downcity 的 `web` plugin 不应直接封装某一家云浏览器或某一个 Computer Use 模型。最适合的底座是：

> **Playwright/CDP 作为跨平台浏览器控制内核，定义 Downcity 自己的 provider-neutral Web SPI；Stagehand、Computer Use、Kitesurf、Browserbase、agent-browser、OpenCLI 和 ego (lite) 都作为可替换适配器或可选 Skill。**

推荐的默认路径是：

```text
搜索/资料发现 → Search Provider
已知 URL 读取 → HTTP/Reader Provider
结构化网页操作 → Playwright + CDP
自然语言动作/自愈 → Stagehand（可选）
视觉、Canvas、复杂未知 UI → Computer Use（最后回退）
登录态用户浏览器 → OpenCLI / ego (lite)（用户选择）
大规模云端隔离 → Browserbase / Browser Use Cloud / Kitesurf（部署选择）
```

不建议把当前 `WebPlugin` 继续做成“长 system prompt + install 提示词”。它应该成为能力注册和路由边界；安装、技能发现和技能读取继续由 `SkillPlugin` 负责。

## 二、先统一概念：这些方案不在同一层

| 层级 | 解决的问题 | 代表方案 | 是否适合作为 WebPlugin 底座 |
|---|---|---|---|
| 搜索/网页读取 API | 发现来源、抓取已知页面、抽取正文 | Tavily、Exa、Brave Search、SerpAPI、Firecrawl、Jina Reader | 适合作为 provider，不适合作为完整浏览器底座 |
| 浏览器协议/自动化 | 打开页面、DOM、网络、截图、点击、输入 | Playwright、Puppeteer、Selenium、CDP | **最适合作为核心 SPI 的底层协议** |
| Agent 浏览器编排 | 用自然语言做动作、观察、抽取、自愈 | Stagehand、browser-use、Skyvern | 适合作为可选高阶适配器 |
| Agent 优化 CLI/Skill | 将浏览器状态压缩成模型易消费的命令输出 | Vercel agent-browser、OpenCLI | 适合作为本地 Skill/CLI provider |
| Computer Use 模型 | 模型输出鼠标、键盘、滚动等屏幕动作 | OpenAI CUA、Anthropic Computer Use、Gemini Computer Use | 适合作为视觉回退，不应成为唯一内核 |
| 云浏览器基础设施 | 隔离、持久化、代理、并发、录像和托管 | Browserbase、Browserless、Steel、Anchor、Browser Use Cloud | 适合作为部署适配器 |
| Agent-first 浏览器/本地桥接 | 复用用户已登录的浏览器或提供更轻浏览器 | Cloudflare Kitesurf、ego (lite)、OpenCLI | 适合特定场景，不适合作为唯一公共依赖 |
| 协议/连接器 | 让现有 Agent 通过统一工具协议调用浏览器 | Browserbase MCP、Playwright MCP、Browser Use MCP、Chrome DevTools MCP | 适合宿主集成层，不应反向定义 SDK 核心模型 |

## 三、主流方案评估

### 3.1 Cloudflare Kitesurf / Browser Run

Cloudflare 在 2026-08-06 公布 Kitesurf，定位是运行在 Cloudflare Workers V8 isolate 上、为 Agent 设计的 stateless 浏览器；通过 Browser Run 提供 beta 能力。官方强调它针对 Agent 的 token、结构化内容、成本、隔离和弹性，而不是人类浏览器的扩展、主题和像素级渲染。

技术特点：

- 以 CDP WebSocket/HTTP API 对外暴露，理论上可兼容 Playwright、Puppeteer 和 Chrome DevTools 前端。
- 使用 Engine、PageScript、PageRenderer 分离页面状态、脚本执行和渲染。
- 网络出口由独立 SandboxOutbound worker 管理，页面 cookie 隔离，页面输入被视为不可信。
- 大量组件无状态，适合突发并发；官方称已通过约 215,000+ WPT tests。
- 对 HTML、DOM、CSS、截图和抽取等 Agent 常用任务，比 Chromium 更节省 CPU/内存；但仍处 beta，生态、兼容性和供应商绑定需要验证。

判断：Kitesurf 很适合作为未来的“云端浏览器 provider”，尤其是大规模无头读取、截图和结构化抽取；不适合作为 Downcity SDK 的硬编码底座，因为它绑定 Cloudflare Workers/Browser Run 运行环境，且登录态、扩展、真实 Chrome 兼容性和 beta 稳定性仍是边界。

来源：[Cloudflare Kitesurf 官方介绍](https://blog.cloudflare.com/kitesurf/)、[Browser Run 文档](https://developers.cloudflare.com/browser-run/)。

### 3.2 Computer Use：OpenAI、Anthropic、Google

Computer Use 不是浏览器，而是模型控制协议：模型观察截图或桌面状态，返回 click、type、scroll、keypress、wait 等动作，宿主执行后再把新状态反馈给模型。

优点：

- 能处理没有稳定 DOM 语义的页面、Canvas、远程桌面和跨应用任务。
- 对未知页面的泛化能力通常优于纯 selector 自动化。

缺点：

- 每一步都需要截图/模型调用，延迟、token 和成本高。
- 坐标或视觉判断会出错，难以达到 Playwright 的确定性。
- Prompt injection、误操作、付款/发送/删除等高风险动作必须由宿主控制确认。
- 不同厂商的 action schema、模型能力、区域和计费都不同。

判断：Computer Use 应该是 `BrowserProvider` 的可选 `visual_fallback`，用于 DOM/语义动作失败时的最后一公里，不应让 WebPlugin 直接依赖某一家模型。Stagehand 官方文档也展示了把 OpenAI/Anthropic Computer Use 接到浏览器动作循环中的模式。

来源：[OpenAI Computer Use 文档](https://platform.openai.com/docs/guides/tools-computer-use)、[Anthropic Computer Use 文档](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use)、[Google Gemini Computer Use 文档](https://cloud.google.com/vertex-ai/generative-ai/docs/computer-use)。

### 3.3 OpenCLI

OpenCLI 的定位是“把已登录的浏览器交给 CLI 和 AI Agent”。官方站点说明它复用本地 Chrome 的登录态，把网站动作转成稳定命令；同时支持浏览器和部分桌面应用，并有 YAML pipeline、TypeScript adapter、插件、录制回放、生命周期钩子和自动诊断。

优点：

- 对需要登录态的社交媒体、SaaS 后台和本地用户账号很实用。
- CLI 文本结果对 Agent 友好，避免把完整页面噪声塞进上下文。
- 通过 adapter/plugin 可快速覆盖大量网站。

缺点：

- 强依赖本地 Chrome、扩展/daemon 和用户登录态。
- 账户权限、页面副作用和站点 adapter 质量由用户环境决定。
- 不适合作为无头云端多租户的隔离内核。

判断：OpenCLI 适合做 `local_logged_in_browser` provider 或 Skill，不适合成为 WebPlugin 的默认跨平台内核。

来源：[OpenCLI 官方站点](https://opencli.info/)、[GitHub 仓库](https://github.com/jackwener/opencli)。

### 3.4 ego (lite)

ego (lite) 是面向 AI Agent 的本地浏览器，重点是与用户共享登录状态、在独立 Spaces 中运行任务，并通过 `ego-browser` Skill 让 Codex、Claude Code 等 Agent 操作浏览器。官方公开信息显示它当前以 Mac 下载和候补/企业入口为主。

它提出三层交互：视觉和动作、少量高频封装方法（例如 Snapshot）、以及必要时的底层浏览器能力；其产品文档强调“代码优先”而不是把所有能力压成一组 CLI 命令。

判断：ego (lite) 适合“用户已经登录、Agent 需要在本机完成真实业务操作”的体验；它不是通用云端 SDK 底座，存在平台覆盖、产品可用性和商业服务依赖。可以通过 `BrowserProvider` 接入，但不应写入 WebPlugin 核心协议。

来源：[ego (lite) 官方站点](https://lite.ego.app/)、[官方 GitHub](https://github.com/citrolabs/ego-lite)。

### 3.5 agent-browser

Vercel 的 agent-browser 是面向 AI Agent 的浏览器自动化 CLI，官方站点强调 compact text output、低上下文占用和 Rust 原生实现；支持本地 Chrome、CDP、多个云 provider（包括 Browserbase、Browserless、Kernel、Remote Agent Browser 等），并提供 session、snapshot、network、录制、文件、代理和安全等能力。

优点：

- 对已有 Shell/Skill 架构非常友好。
- Snapshot 和紧凑文本输出适合模型上下文。
- 既可本地运行，也能通过 provider 连接云浏览器。

缺点：

- CLI 是调用面，不是长期稳定的领域对象模型。
- 需要把命令输出解析成 Downcity 的结构化结果，错误语义和生命周期要额外封装。
- 仍然要依赖底层 Chrome/CDP 或云 provider。

判断：agent-browser 很适合作为 Downcity 的第一阶段“可选 Skill/CLI adapter”，但不建议直接让 `WebPlugin` 把 CLI 字符串当作公开 API。核心接口仍应抽象为 session、observe、act、extract。

来源：[agent-browser 官方文档](https://agent-browser.dev/)、[Vercel GitHub 仓库](https://github.com/vercel-labs/agent-browser)。

### 3.6 Stagehand / browser-use / Skyvern

**Stagehand** 是 Browserbase 维护的开源浏览器 Agent SDK，建立在 Playwright 之上，提供 `act`、`extract`、`observe` 和更高阶 `agent`；官方文档展示了 MCP、OpenAI/Anthropic Computer Use、动作回放和失败自愈。它在“确定性的 Playwright + 必要时 AI 接管”之间做了比较好的折中。

**browser-use** 提供 Python 开源库、云端任务 API、托管 Agent、stealth browser、代理和自定义模型。官方站点同时提供 Browser Use Cloud 与开源库，当前生态活跃度很高，但其 Agent loop、模型和云服务边界较重。

**Skyvern** 是开源的视觉/浏览器自动化平台，通常以自然语言任务、工作流、结构化提取和云/自托管方式使用；更接近“完整自动化产品”而不是轻量 SDK 内核。

判断：这三者都适合做高阶 provider 或任务编排层，不宜成为 Downcity 基础协议。Stagehand 最适合优先适配，因为它保留 Playwright 互操作性，并且能把 AI 介入限制在动作失败、自然语言抽取和视觉场景。

来源：[Stagehand 官方文档](https://docs.stagehand.dev/v2/best-practices/build-agent)、[Stagehand GitHub](https://github.com/browserbase/stagehand)、[browser-use 官方站点](https://browser-use.com/)、[browser-use GitHub](https://github.com/browser-use/browser-use)、[Skyvern GitHub](https://github.com/Skyvern-AI/skyvern)。

### 3.7 云浏览器基础设施

| 方案 | 主要价值 | 适配判断 |
|---|---|---|
| Browserbase | 托管 Chromium、session、代理、录制、调试、MCP，并与 Stagehand 深度结合 | 适合生产云 provider；商业绑定较强 |
| Browserless | 托管 Chrome/CDP、Playwright/Puppeteer、抓取和浏览器 API | 适合基础设施 provider；需自行做 Agent 语义层 |
| Steel | 开源/云浏览器 session，偏 Agent 和开发者 API | 可作为轻量云 provider，需验证规模与长期 SLA |
| Anchor Browser | 云浏览器、持久 session、企业账号和自动化 API | 适合企业登录态流程；供应商依赖较强 |
| Browser Use Cloud | 与 browser-use Agent loop、stealth browser 和任务 API 一体化 | 适合快速上线完整 Agent，但不适合作为中立 SDK 内核 |
| BrowserStack | 大量真实浏览器/设备和测试基础设施 | 更偏测试，不是 Agent 运行时首选 |
| Kernel / Remote Agent Browser | agent-browser 等工具可连接的云 provider | 适合作为可插拔部署后端 |

云浏览器都能解决“浏览器运行在哪里”的问题，但不能替代 Downcity 的能力模型、权限、审批、证据和生命周期设计。

### 3.8 搜索、读取和抽取服务

对于“联网”任务，大量请求不需要启动浏览器。建议把以下能力作为独立 provider：

- **Tavily / Exa / Brave Search / SerpAPI**：搜索、结果排序和来源发现。
- **Firecrawl / Jina Reader**：已知 URL 的正文读取、Markdown 化、爬取和结构化抽取。
- **直接 HTTP/`fetch`**：官方 API、JSON、RSS、源码和静态页面的低成本路径。

最佳实践是先搜索或直接读取，只有在动态渲染、登录态、交互、反爬、文件上传或复杂表单时才进入浏览器。把每个任务都交给 Computer Use 或完整 Agent loop，会明显增加成本和不稳定性。

## 四、横向比较

评分含义：5 为强，1 为弱；这是针对 Downcity SDK 底座的工程判断，不是各产品的绝对排名。

| 方案 | 确定性 | 复杂页面 | 登录态 | 云伸缩 | 开源/可替换 | Context 效率 | 推荐位置 |
|---|---:|---:|---:|---:|---:|---:|---|
| Playwright/CDP | 5 | 4 | 4 | 4 | 5 | 4 | 核心底座 |
| Stagehand | 4 | 5 | 4 | 4 | 5 | 4 | 高阶动作适配器 |
| browser-use | 3 | 5 | 4 | 5 | 4 | 3 | 完整 Agent provider |
| agent-browser | 4 | 4 | 4 | 4 | 4 | 5 | CLI/Skill provider |
| OpenCLI | 3 | 4 | 5 | 1 | 4 | 5 | 本地登录态 provider |
| ego (lite) | 3 | 4 | 5 | 1 | 2 | 4 | 本地浏览器 provider |
| Computer Use | 2 | 5 | 3 | 3 | 1 | 2 | 视觉回退 |
| Browserbase | 4 | 4 | 4 | 5 | 3 | 4 | 云部署 provider |
| Kitesurf | 4* | 4* | 2* | 5* | 3* | 5* | 云端读取/抽取 provider |
| Firecrawl/Jina | 5 | 2 | 2 | 5 | 3 | 5 | 非浏览器读取 provider |

`*` Kitesurf 仍处于 beta/早期阶段，评分应在实际任务、登录态和区域可用性测试后调整。

## 五、对 Downcity WebPlugin 的具体设计建议

### 5.1 核心职责

WebPlugin 应回答：

> 当前 Agent 有哪些联网和浏览器能力？如何选择、执行、审批和记录这些能力？

它不应该负责：

- 自己安装 Skill 或 CLI。
- 固定选择 Browserbase、Kitesurf 或某个模型。
- 把整段方法论永久注入所有会话。
- 复制 SkillPlugin 的扫描根和安装规则。

### 5.2 建议的最小 SPI

```ts
interface WebSearchProvider {
  search(input: WebSearchInput): Promise<WebSearchResult>;
}

interface WebDocumentProvider {
  open(input: WebOpenInput): Promise<WebDocument>;
}

interface BrowserProvider {
  create_session(input: BrowserSessionInput): Promise<BrowserSession>;
  observe(session_id: string): Promise<BrowserObservation>;
  act(session_id: string, action: BrowserAction): Promise<BrowserObservation>;
  close_session(session_id: string): Promise<void>;
}
```

实现上建议：

1. `PlaywrightBrowserProvider`：默认、开源、可本地运行，也可连接任何 CDP 云浏览器。
2. `StagehandBrowserProvider`：提供自然语言 `act`、`extract` 和失败自愈；底层仍回到 Playwright。
3. `AgentBrowserProvider`：通过 agent-browser CLI/服务接入，作为 Skill 兼容层。
4. `ComputerUseBrowserProvider`：只在显式启用或动作失败时使用，并接入审批策略。
5. `BrowserbaseProvider`、`KitesurfProvider`、`BrowserUseCloudProvider`：只实现 session transport，不泄漏供应商类型到 Agent API。
6. `OpenCliProvider`、`EgoLiteProvider`：作为本地登录态可选 provider，不作为默认 provider。

### 5.3 Action 设计

建议公开结构化 action，而不是返回安装提示词：

```text
web.search
web.open
web.browser.create_session
web.browser.observe
web.browser.act
web.browser.extract
web.browser.close_session
```

每个结果都应该包含：`provider`、`session_id`（如有）、`url`、`title`、`content`/`snapshot`、`evidence`、`warnings`、`usage` 和结构化错误。副作用动作（提交、发送、购买、删除、下载、上传）必须经过宿主审批，而不是交给 provider 自行决定。

### 5.4 路由策略

```text
1. 能用直接 HTTP/搜索解决 → 不启动浏览器
2. 已知页面、DOM 稳定 → Playwright/CDP
3. 需要自然语言动作或 selector 自愈 → Stagehand
4. 登录态在用户 Chrome → OpenCLI/ego (lite)
5. 页面高度动态、Canvas 或视觉定位 → Computer Use
6. 大规模、隔离、并发 → Browserbase / Kitesurf / Browser Use Cloud
```

### 5.5 推荐落地顺序

**第一阶段：重构边界，不引入云厂商。**

- 移除当前 `web.install` action。
- 将常驻 Web 方法论改成按需 Skill。
- 定义 provider-neutral types 和能力注册表。
- 先实现 Playwright/CDP provider。
- 提供本地浏览器 session、observe、act、extract、close 生命周期。

**第二阶段：增加 Agent 能力。**

- 接入 Stagehand 作为 AI-assisted adapter。
- 接入 agent-browser 作为低上下文 CLI Skill。
- 引入 Computer Use fallback 和统一审批。

**第三阶段：增加部署适配器。**

- 先接 Browserbase 或 Browserless 做 CDP 云验证。
- 再评估 Kitesurf 的成本、兼容性、登录态和稳定性。
- 对 Browser Use Cloud、Steel、Anchor 保持同一 SPI 的可选实现。

## 六、最终选择

### 如果只能选一个底座

选 **Playwright + CDP**。

原因：

- 开源且跨平台，避免供应商锁定。
- 既支持本地 Chrome，也能连接 Browserbase、Browserless、Kitesurf 等远程实现。
- DOM、网络、文件、截图、上下文和生命周期语义成熟。
- 可让确定性自动化和 AI 自动化共存。
- 与 Stagehand、agent-browser、Computer Use 的组合成本最低。

### 如果目标是最快做出云端生产能力

选 **Browserbase + Stagehand** 作为第一个商业适配器，但仍把它包在 Downcity 自己的 `BrowserProvider` 后面。

### 如果目标是大规模低成本读取/抽取

优先评估 **Kitesurf/Browser Run**，但只作为云端 provider；在 beta 稳定性、动态 JS、登录态、下载上传和站点兼容性完成基准测试前，不应成为默认实现。

### 如果目标是用户本机的登录态操作

提供 **OpenCLI 或 ego (lite)** 的可选 Skill/provider；不要把用户 Chrome 的权限和生命周期隐式带入通用 WebPlugin。

### 当前 Downcity 落地状态

本次实现已经把上述底座决策落到 `@downcity/plugins/web`：

- `PlaywrightBrowserProvider` 通过 CDP 连接外部 Chrome/Chromium，负责 session、观察、确定性动作、抽取和释放。
- `SemanticBrowserProviderAdapter` 通过 callback 接入 Stagehand 或其他语义模型，不把 Stagehand SDK 变成核心硬依赖。
- `ComputerUseBrowserProviderAdapter` 在语义动作前获取带截图的 observation，把视觉模型循环留给宿主，并保持 JSON-only action 边界。
- City 内建 Web Plugin 只接受显式 `cdp_url` 配置；搜索、HTTP Reader、云浏览器和本地登录态方案可以按部署需要注入。
- agent-browser、OpenCLI 和 ego (lite) 保持在 Skill/CLI 或可选 provider 边界，不进入核心 session 对象。

因此“最好的方案”不是单一供应商，而是 **Playwright/CDP + Downcity provider SPI**；生产环境再按任务类型选择 Browserbase、Browserless、Kitesurf 或本地浏览器等 transport。

## 七、必须建立的基准测试

在正式选型前，建议使用同一组任务测试所有 provider：

- 静态官方文档读取与引用。
- JS 渲染页面和分页。
- 登录态 SaaS 查询但不提交副作用。
- iframe、弹窗、下载和文件上传。
- Canvas/地图/拖拽/验证码前的阻塞识别。
- Prompt injection 页面隔离与告警。
- 10、100、1000 并发下的冷启动、成本和失败恢复。
- context bytes、模型调用次数、P50/P95 延迟、任务成功率和可回放性。

没有这些数据时，不能仅凭宣传中的“准确率”“最快”或 GitHub star 做底座决策。

## 八、来源索引

- [Cloudflare：Introducing Kitesurf](https://blog.cloudflare.com/kitesurf/)
- [Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/)
- [Stagehand：Build a web browsing agent](https://docs.stagehand.dev/v2/best-practices/build-agent)
- [Stagehand GitHub](https://github.com/browserbase/stagehand)
- [browser-use](https://browser-use.com/)
- [browser-use GitHub](https://github.com/browser-use/browser-use)
- [agent-browser](https://agent-browser.dev/)
- [agent-browser GitHub](https://github.com/vercel-labs/agent-browser)
- [OpenCLI](https://opencli.info/)
- [OpenCLI GitHub](https://github.com/jackwener/opencli)
- [ego (lite)](https://lite.ego.app/)
- [ego (lite) GitHub](https://github.com/citrolabs/ego-lite)
- [OpenAI Computer Use](https://platform.openai.com/docs/guides/tools-computer-use)
- [Anthropic Computer Use](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use)
- [Google Gemini Computer Use](https://cloud.google.com/vertex-ai/generative-ai/docs/computer-use)
- [Playwright](https://playwright.dev/)
- [Browserbase](https://www.browserbase.com/)
- [Browserless](https://www.browserless.io/)
- [Steel](https://steel.dev/)
- [Anchor Browser](https://www.anchorbrowser.io/)
- [Firecrawl](https://www.firecrawl.dev/)
- [Jina Reader](https://jina.ai/reader/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

# Downcity 关键词矩阵与优化方案（2026-09-18）

> 站点：https://downcity.ai（React Router 7 + Cloudflare Pages 预渲染，中英双语）
> 配套审计：[`homepage-seo-audit-2026-09-18.md`](./homepage-seo-audit-2026-09-18.md)

## 数据来源与可信度声明

本文的关键词判断**不是凭记忆列举的**，来自 2026-09-18 实时采样的搜索引擎联想词接口：

| 来源 | 方法 | 覆盖 |
|---|---|---|
| Bing Autosuggest | `api.bing.com/osjson.aspx`，31 个种子词 | 英文为主，含少量中文长尾 |
| Baidu Suggest | `suggestion.baidu.com/su`，10 个种子词 | 中文 |

**必须诚实说明的两点**：

1. **本文没有搜索量（volume）与难度（KD）数字。** 环境内没有 Ahrefs / Semrush 等第三方工具，Google Suggest 也不可达。联想词能证明「**这个词真实存在且有人搜**」「**搜的人还关心什么**」，但不能给出量级。
2. **不要把我给的方向当成 volume 证据。** 真正的量级与点击数据只能来自 Google Search Console。这恰好是[审计报告](./homepage-seo-audit-2026-09-18.md)第二节里连续三轮未做的 P2-3，也仍然是本方案最大的风险点。

联想词的用法：当输入一个种子词后，接口**返回了该词自身的扩展**，说明它有真实检索行为；当返回的扩展**与该词无关**，说明它几乎没有检索量，只是自造词。

---

## 一、三个关键结论（先看这个）

### 结论 1：「Agent Harness」是真实、有竞争、且与 Downcity 定位完全咬合的品类词 —— 应当作为唯一主攻品类

Bing 对 `agent harness` 的返回（节选）：

```
agent harness engineering a survey      ← 已有学术综述在写这个品类
agent harness survey
agent harness anthropic                 ← Anthropic 已在这个词上占据心智
agent harness github
agent harness framework
agent harness framework 2026
agent harness vs mcp                    ← 一个明确的对比型搜索意图
agent harness是什么 / 是什么意思
what is an agent harness in ai
the anatomy of an agent harness         ← 内容型意图，适合长文
awesome-agent-harness
effective harness for long running agents
```

判断：这是一个**正在成形的品类词**，已经有综述论文、有 Anthropic 的占位、有 GitHub 生态、有对比型与解释型需求。Downcity 的自我定义正是 Agent Harness，**这是全站最值得投入的一个词**。

### 结论 2：「Agent Productization」几乎没有搜索需求 —— 它是定位词，不是关键词

Bing 对 `agent productization` 只返回：

```
what is a processing agent
what is a process agent
```

即：搜索引擎**找不到这个词的检索行为**，只能回退去猜「process agent」。同理 `agent productization` 在中文侧也没有对应聚类。

**这不意味着要放弃它。** 它的价值在于**品牌定位与 AI/LLM 实体识别**（让模型把 Downcity 和「Agent 产品化」这个概念绑在一起），而不是带来自然搜索流量。所以：

- ✅ 保留在 H1、title、结构化数据、`llms.txt` 里 —— 用于定义品类、被 AI 引用
- ❌ 不要为它做页面、不要把它当成流量目标、不要为它写内容

### 结论 3：「City SDK」「Federation SDK」是被污染的通用词，只做品牌导航

| 种子词 | Bing 返回的扩展 | 判断 |
|---|---|---|
| `city sdk` | `citysdk`、`city skylines 3`、`city skyline png`、`city skyline 2 free play`… | 被《城市天际线》游戏 + US Census CitySDK 完全污染，**与 Downcity 的 City 无关** |
| `federation sdk` | `federations dlc`、`federation square`、`federation square melbourne` | 指向墨尔本联邦广场等，**完全无关** |

**这两个词不具备可争夺的自然搜索流量。** 它们只应承担品牌导航（用户已经听说过 Downcity，来搜它）。

同时中文侧的发现更关键：

| 种子词 | Baidu 返回 | 判断 |
|---|---|---|
| `Agent 运行时` | 南京小学教师、高压锅划拳歌、幼儿园期末汇报… | **完全无关 → 「Agent 运行时」不是真实的中文搜索词** |

**行动含义**：中文页面上不要把「Agent 运行时」当作关键词堆。「agent runtime」直译成中文是无效的。中文用户真正的检索路径见下节。

---

## 二、英文关键词矩阵

意图取值：信息型（了解概念）／商业调研（选型）／导航型（找已知品牌）／实施型（动手做）。

### 2.1 第一梯队：主攻（品类头词 + 定位词）

| 关键词 | 意图 | 承接页 | 现状 | 优先级 |
|---|---|---|---|---|
| agent harness | 信息型 + 商业调研 | `/`、`/zh/`、`/features/` | ✅ H1 与 title 已命中 | **最高** |
| open source agent harness | 信息型 + 选型 | `/`、`/whitepaper/` | ⚠️ 仅在正文，title 未显式 | 高 |
| agent harness features | 商业调研 | `/features/` | ✅ 本轮已写入 title | 高 |
| agent harness quickstart | 实施型 | `/start/` | ✅ 本轮已写入 title | 高 |
| agent harness architecture | 信息型 | `/whitepaper/` | ✅ 本轮已写入 title | 高 |
| what is an agent harness | 信息型（量最大、竞争最轻） | **无承接页** | ❌ 缺口 | **最高（新建）** |
| the anatomy of an agent harness | 信息型 | **无承接页** | ❌ 缺口（长文机会） | 高（新建） |
| agent harness vs mcp | 对比型 | **无承接页** | ❌ 缺口 | 高（新建） |

### 2.2 第二梯队：产品与选型（承接页已存在）

| 关键词 | 意图 | 承接页 | 现状 | 优先级 |
|---|---|---|---|---|
| agent sdk python | 实施型 | `/product/agent-sdk/`、`/en/agent-sdk-docs/` | ⚠️ 长尾，未优化 | 高 |
| agent sdk documentation | 实施型 | `/en/agent-sdk-docs/` | ✅ 文档区已存在 | 中 |
| agent orchestration framework | 商业调研 | `/en/city-sdk-docs/`、`/en/docs/federation/overview/` | ⚠️ 有内容无对应词 | 中 |
| agent memory management | 信息型 + 实施型 | `/en/plugins-docs/`（memory plugin） | ⚠️ 有内容无对应词 | 中 |
| agent sandbox | 实施型 | `/en/docs/security/overview/`、`/en/docs/agent/overview/` | ⚠️ 有内容无对应词 | 中 |
| agent deployment / agent hosting | 商业调研 | `/resources/hosting/` | ✅ 本轮已写入 title | 中 |
| ci for ai agents / agent ci | 商业调研 | 无 | ❌ 缺口 | 低（待验证） |

**重要提醒**：`agent sdk`、`agent runtime`、`agent memory` 这类**头部词已被大厂占据**（Anthropic / OpenAI / Microsoft / Google / GCP）。Bing 证据：

```
agent runtime → agent runtime gcp（Google Cloud 的 Vertex Agent Runtime 占位）
agent sdk     → agent sdk claude / openai / anthropic / microsoft / google
```

结论：**不要正面竞争这些头部词**，只做 `agent sdk python`、`agent runtime environment`、`agent runtime monitoring` 这类长尾。

### 2.3 不要投入的词（明确放弃）

| 关键词 | 原因 |
|---|---|
| agent productization | 无检索行为（结论 2），仅作品牌定位 |
| city sdk | 被游戏与 US Census 污染（结论 3） |
| federation sdk | 指向墨尔本联邦广场等无关结果 |
| agent billing | 返回企业财务软件（business central、billing agent id 等） |
| agent permissions | 返回 SQL Server Agent / Cloud Run service agent 等无关结果 |
| agent marketplace | 无联想词返回，需求不明 |
| agent deployment | 返回 SolarWinds、Databricks 等企业 IT 语境 |

---

## 三、中文关键词矩阵（与英文不同，必须分开做）

中文的检索语言与英文**不一致**，这是 Downcity 中文站当前最被忽略的机会。

| 关键词 | 意图 | 承接页 | 现状 | 优先级 |
|---|---|---|---|---|
| 智能体框架 | 信息型 + 商业调研 | `/zh/`、`/zh/features/` | ❌ 未出现 | **最高** |
| 智能体框架有哪些 | 信息型 | 无 | ❌ 缺口 | 高（新建） |
| 智能体框架选型 | 商业调研 | 无 | ❌ 缺口 | 高（新建） |
| AI Agent 开发 | 信息型 + 实施型 | `/zh/start/` | ⚠️ 正文未显式 | 高 |
| AI Agent 开发框架 | 商业调研 | `/zh/product/` | ❌ 未出现 | 高 |
| AI Agent 架构 | 信息型 | `/zh/whitepaper/` | ⚠️ 本轮 title 用了「生产级 Agent 架构」 | 高 |
| AI Agent 架构图 | 信息型 | 无 | ❌ 缺口（配图长文） | 中 |
| 多智能体 / 多智能体协作 | 信息型 | `/zh/docs/federation/`、`/zh/city-sdk-docs/` | ⚠️ 有内容无对应词 | 中 |
| 智能体编排 | 信息型 + 商业调研 | `/zh/docs/federation/` | ❌ 未出现 | 中 |
| 智能体记忆 | 信息型 | `/zh/plugins-docs/`（memory plugin） | ⚠️ 有内容无对应词 | 中 |
| AI Agent 工具 / AI Agent 平台 | 商业调研 | `/zh/resources/` | ❌ 未出现 | 中 |
| ~~Agent 运行时~~ | — | — | ❌ **伪词，放弃** | 不投入 |
| 智能体（单独） | 信息型 | — | 太宽，不建议单独争 | 低 |

**中文侧的核心判断**：中文用户搜的是「智能体框架 / AI Agent 开发 / AI Agent 架构」，而不是「Agent 运行时」。而 `智能体框架` 的联想词里出现 `langchain`、`AI Agent 开发框架对比`，说明这是**选型与对比语境**——与 Downcity 的产品矩阵页天然匹配。

---

## 四、本轮已实施的关键词优化

把 7 个「只有品牌词 + 栏目名」的薄 title 页改为关键词先行、品牌收尾。全部经产物验证（title 长度 35–57 字符、`h1=1`、`hreflang=3`）。

| 页面 | 优化前 title | 优化后 title |
|---|---|---|
| `/features/` | `Downcity — Features` (19) | `Agent Harness Features: Runtime, Memory, Tools — Downcity` (57) |
| `/zh/features/` | `Downcity — 功能` (13) | `Agent Harness 功能：运行时、记忆、工具与权限 — Downcity` (40) |
| `/start/` | `Downcity — Quick Start` (22) | `Agent Harness Quickstart: Run Your First Agent — Downcity` (57) |
| `/zh/start/` | `Downcity — 快速开始` | `Agent Harness 快速开始：运行你的第一个 Agent — Downcity` (43) |
| `/whitepaper/` | `Downcity — Whitepaper` (21) | `Agent Harness Whitepaper: Production Agents — Downcity` (54) |
| `/zh/whitepaper/` | `Downcity — 白皮书` | `Agent Harness 白皮书：生产级 Agent 架构 — Downcity` (41) |
| `/community/faq/` | `Downcity — FAQ` (14) | `Agent Harness FAQ: Models, Memory, Deployment — Downcity` (56) |
| `/zh/community/faq/` | `Downcity — 常见问题` | `Agent Harness 常见问题：模型、记忆与部署 — Downcity` (38) |
| `/resources/skills/` | `Downcity — Skills` (17) | `Agent Skills Directory: Reusable Capabilities — Downcity` (56) |
| `/zh/resources/skills/` | `Downcity — Skills 技能` | `Agent Skills 目录：可复用的 Agent 能力 — Downcity` (40) |
| `/resources/hosting/` | `Downcity — Hosting` (18) | `Managed Agent Hosting: Run Agents Continuously — Downcity` (57) |
| `/zh/resources/hosting/` | `Downcity — 托管` | `托管 Agent 运行：让 Agent 持续在线 — Downcity` (35) |
| `/community/roadmap/` | `Downcity — Roadmap` (18) | `Agent Harness Roadmap: What We Ship Next — Downcity` (51) |
| `/zh/community/roadmap/` | `Downcity — 路线图` | `Agent Harness 路线图：下一步在做什么 — Downcity` (36) |

同时本轮已完成（详见审计报告第九节）：首页 H1 品类化、产品总览页 6 宫格（新增 Federation SDK 与 Services 卡片）、`/product/city-sdk/` 与 `/product/federation-sdk/` 拆分、`/resources/examples/` 与 4 条 404 修复、18 个中文页预渲染语言修复。

---

## 五、下一步：信息型内容缺口（按优先级）

Downcity 目前**只有产品页 + 文档，没有一篇信息型内容**。而联想词证据显示，需求的大头恰恰在信息型（`what is an agent harness`、`the anatomy of...`、`agent harness vs mcp`、`智能体框架有哪些`）。

按「客户影响 / 内容匹配 / 搜索潜力 / 资源」四因子排序：

| 优先级 | 标题（建议） | 类型 | 目标词 | 说明 |
|---|---|---|---|---|
| 1 | What Is an Agent Harness? A Plain Explanation | 术语页 | `what is an agent harness` | **门槛最低、竞争最轻**。Downcity 的定义权主场，最该先写 |
| 2 | The Anatomy of an Agent Harness | 长文 | `the anatomy of an agent harness` | 拆解 runtime / session / memory / tools / permissions，直接映射 Downcity 的架构 |
| 3 | Agent Harness vs MCP: Different Layers, Not Rivals | 对比页 | `agent harness vs mcp` | 联想词里已有明确对比意图，且能顺势解释 Downcity 与 MCP 的关系 |
| 4 | 智能体框架怎么选：选型清单 | 对比/选型页 | `智能体框架选型`、`AI Agent 开发框架对比` | 中文侧唯一的高意图词，直接导向产品矩阵页 |
| 5 | Agent Memory vs RAG: When You Need Both | 对比页 | `agent memory vs rag` | 复用 `/en/plugins-docs/` 已有的 memory 内容 |
| 6 | Agent Orchestration Patterns | 长文 | `agent orchestration patterns` | 复用 Federation / Service / Group 的现有文档 |
| 7 | How to Charge for an AI Agent Product | 长文 | `agent billing`（长尾） | 唯一能承接 Services & Payment 的信息型内容 |

**内容形态建议**：先做 1–3（英文，术语页 + 长文 + 对比页），它们是 Hub，后续 spokes 都往它们内链；中文侧从第 4 条起步。

---

## 六、关键词 → 页面映射总表（防蚕食）

一个词只允许一个主承接页。新增页面前先查这张表。

| 页面 | 主关键词 | 次要关键词 |
|---|---|---|
| `/` `/zh/` | agent harness（中：Agent Harness） | open source agent harness |
| `/features/` `/zh/features/` | agent harness features（智能体框架能力） | agent runtime features、agent permissions |
| `/start/` `/zh/start/` | agent harness quickstart（AI Agent 开发） | install agent cli |
| `/whitepaper/` `/zh/whitepaper/` | agent harness architecture（AI Agent 架构） | production agents、human-agent collaboration |
| `/product/` `/zh/product/` | AI Agent 开发框架、agent infrastructure products | product matrix |
| `/product/city-sdk/` | agent host / 本地 Agent 宿主 | City runtime |
| `/product/federation-sdk/` | agent backend reuse / Service 路由 | model catalog、usage、payment |
| `/product/agent-sdk/` | agent sdk python、agent sdk documentation | session、plugin |
| `/product/ui-sdk/` | agent workspace ui | agent console components |
| `/resources/skills/` `/zh/resources/skills/` | agent skills directory | 智能体技能 |
| `/resources/hosting/` `/zh/resources/hosting/` | agent hosting、agent deployment | managed runtime |
| `/community/faq/` `/zh/community/faq/` | agent harness faq | agent memory、agent permissions（答疑向） |
| `/community/roadmap/` | agent harness roadmap | — |
| `/en/plugins-docs/` | agent memory management、智能体记忆 | memory plugin、agent tools |
| `/en/docs/security/*` | agent sandbox、agent permissions | sandbox 边界、权限模型 |
| `/en/docs/federation/*` | agent orchestration framework、智能体编排、多智能体协作 | service routing |
| `/en/payments/` | agent billing（长尾）、AI agent 计费 | credits、usage metering |
| 新建：术语页 | what is an agent harness | Agent Harness 是什么 |
| 新建：架构长文 | the anatomy of an agent harness | agent harness components |
| 新建：对比页 | agent harness vs mcp | harness vs framework |
| 新建：中文选型页 | 智能体框架选型、智能体框架有哪些 | AI Agent 开发框架对比 |

---

## 七、最关键的 3 个行动项

1. **把「Agent Harness」确立为唯一主攻品类词**，`agent productization` 只作品牌定位与 AI 实体词，不投入关键词资源。本轮 7 个页面的 title 已按此改造。
2. **新建第 1 篇信息型内容：`What Is an Agent Harness?`**，并配 `The Anatomy of an Agent Harness` 与 `Agent Harness vs MCP`。这是从「只有产品页」转向「有搜索入口」的第一步，且竞争最轻。
3. **接入 Google Search Console 并回填上面的关键词表**。本文所有优先级判断都基于「该词真实存在」的证据，**没有任何 volume 数据**；只有 GSC 能告诉你哪些词已经在曝光、哪些该放弃。这是第四轮被提及的同一个缺口。

---

## 八、已落地：第一篇文章（2026-09-18）

### 8.1 关键词选定（最终）

| 项 | 取值 | 依据 |
|---|---|---|
| 英文主目标词 | `what is an agent harness` | Bing 联想词集中返回 `what is an agent harness in ai`，意图高度一致 |
| 英文次目标 | `agent harness meaning`、`agent harness explained`、`agent harness components` | 同一意图聚类 |
| 中文主目标词 | `agent harness 是什么` | Baidu 实测返回 `agent harness是什么`、`agent harness是什么意思` |
| LSI / 支撑词 | agent runtime、agent framework、MCP、agent session、agent permissions、agent memory | 来自 `agent harness vs mcp`、`agent runtime environment` 等联想词 |
| **排除** | `agent harness`（头部词归首页）、`agent productization`（无检索量） | 避免蚕食，且后者不带来流量 |

**中文侧的关键决策**：不直译。中文用户搜的是「agent harness + 中文疑问词」，而不是「智能体线束是什么」。因此中文标题保留英文原词 `Agent Harness`，后面接中文疑问句。

### 8.2 新增内容基础设施

站点此前只有「产品页 + 文档」，没有承载信息型内容的容器。新增了 `blog` 内容空间（复用既有 fumadocs MDX 管线，但用营销文章版式，不挂文档侧边栏）：

| 文件 | 作用 |
|---|---|
| `source.config.ts` | 新增 `blog` 集合（`content/blog`） |
| `app/lib/blog-source.ts` | blog source 装载，`baseUrl: /blog` |
| `app/routes/blog/page.tsx` | 文章路由：`/en/blog/<slug>/` 与 `/zh/blog/<slug>/`，输出 H1、文章版式与 BlogPosting JSON-LD |
| `app/types/seo.ts` | 新增 `SeoArticleStructuredData` |
| `app/lib/structured-data.ts` | 新增 `create_article_structured_data`，`author/publisher` 复用首页 Organization、`about` 指向 Downcity 软件实体，与首页实体图共享 `@id` |
| `app/routes.ts`、`react-router.config.ts`、`app/routes/sitemap.xml.ts` | 路由注册、预渲染扫描、sitemap 收录 |
| `public/_redirects` | `/blog` 与 `/blog/*` → 英文文章（当前只有一篇，故意不发布空壳列表页） |
| `public/llms.txt` | 加入文章入口，供 AI 引擎引用 |

### 8.3 文章产出

| 页面 | URL | 字数 | 结构 |
|---|---|---|---|
| What Is an Agent Harness? | `/en/blog/what-is-an-agent-harness/` | 约 1380 词 | 8 个 H2、2 张表、9 个列表项 |
| Agent Harness 是什么？ | `/zh/blog/what-is-an-agent-harness/` | 约 1900 汉字 | 同上（独立重写，非直译） |

内容要点：定义 Harness（前 100 词内直接回答）；四层辨析表（模型／框架／Harness／协议）；Harness 负责的 9 项职责；与框架、MCP 的区别；进入生产的 4 个硬要求；Downcity 职责到组件的映射表；7 个常见问题。全文内链 33（EN）／34（ZH）条，全部指向真实存在的页面。

### 8.4 验证结果

- 完整重建：**555 个 HTML**（+2），exit 0
- `test:seo`：**13/13 通过**；`tsc --noEmit`：**exit 0**
- 两页均 `h1=1`、`h2=8`、`hreflang=3`、`canonical` self、`robots=index, follow`、`og:type=article`
- JSON-LD：`BlogPosting`，`inLanguage` 分别为 `en` / `zh-CN`，`about` 指向 `https://downcity.ai/#software`
- sitemap：**547 条**（+2），两条 blog URL 均含双向 hreflang 与 x-default
- 文章内链逐一核验：**67 条全部可解析**，无 404（唯一 `/download/macos` 由 Cloudflare Function 提供，非静态文件）

### 8.5 下一篇建议

按第五节排序，第 2 篇是 `The Anatomy of an Agent Harness`（承主目标词的长尾，可直接复用本文的 9 项职责展开），第 3 篇是 `Agent Harness vs MCP`（联想词里已有明确对比意图）。中文侧第 2 篇建议做 `智能体框架怎么选`，承接中文唯一的高意图选型需求。

---

## 九、第二篇文章上线（2026-09-18）

### 9.1 关键词选定

| 项 | 取值 | 依据 |
|---|---|---|
| 英文主目标词 | `the anatomy of an agent harness` | Bing 联想词原文命中（`what is an agent harness` 的同一意图聚类） |
| 英文次目标 | `agent harness components`、`agent harness architecture`、`agent harness construction` | 来自 `agent-harness-construction`、`what is an agent harness in ai` 聚类 |
| 中文主目标词 | `agent harness 架构` / `agent harness 内部构造` | 中文用户同样以「英文原词 + 中文名词」检索 |
| **单页词策略** | 一篇一个主词，不重叠 | 防蚕食：A1 占 `what is`（定义），A2 占 `anatomy`（结构） |

### 9.2 内容产出

| 页面 | URL | 体量 |
|---|---|---|
| The Anatomy of an Agent Harness | `/en/blog/the-anatomy-of-an-agent-harness/` | 约 2050 词，8 个 H2 + 10 个 H3，含 Mermaid 图 |
| Agent Harness 的内部构造 | `/zh/blog/the-anatomy-of-an-agent-harness/` | 约 1900 汉字，结构对齐、独立重写 |

差异化设计（避免与 A1 重复）：A1 回答「是什么」，A2 回答「职责落在哪里」。A2 的独有内容是**一条请求的九步链路追踪**、**十个子系统的逐层剖析**，以及最有实用价值的一张表：**把生产症状映射到缺失的子系统**（如「部署后无法续跑」→ Session 存储未持久化；「换模型要改代码」→ 提供方逻辑从网关泄漏）。

### 9.3 顺手修掉两个真实缺陷

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| 1 | 所有文章共用同一组 `keywords` | `blog/page.tsx` 把 keywords 写死在路由里，新文章不生效 | 改为从各文 frontmatter 解析（fumadocs 的 `page.data` 不透出自定义字段，因此直接读文件并解析，附注释说明） |
| 2 | （已回退的尝试）文章页多预加载约 680 KB | 怀疑是 Mermaid 静态 import 导致 | 试过 lazy 加载 Mermaid，**实测无效**（chroma/rough 等仍在预加载，资源数还 46→48），已**完整回退**，不留无效代码 |

第 2 项虽未修复，但量化清楚了：文章页加载 **48 个资源 / 1621 KB**，而 `/features/` 为 **31 个 / 943 KB**，**多出 679 KB**；且 A1（无图）与 A2（有图）加载的资源集**完全相同**，说明这块开销来自 fumadocs 的 MDX 浏览器运行时（`browserCollections`），与图表无关。真正的解法是让文章 MDX 在服务端渲染而不是走浏览器 collection，属独立改造，已列入待办。

### 9.4 验证结果

- 完整重建：**557 个 HTML**（+2），exit 0
- `test:seo`：**13/13**；`tsc --noEmit`：**exit 0**
- 四页均 `h1=1`、`h2=8`、`hreflang=3`、canonical self、`BlogPosting` JSON-LD
- `keywords` 已按文章区分（四页各不相同，已验证）
- sitemap：**549 条**（+2），两条新 URL 均含双向 hreflang 与 x-default
- 文章内链：EN 37 条 / ZH 38 条，**除预存的 `/download/macos`（由 Cloudflare Function 提供）外无失效**
- `llms.txt` 已加入两篇文章入口；`_redirects` 覆盖 `/blog` 与 `/blog/*`

### 9.5 待办（按价值排序）

1. **文章页减重**：把 MDX 改为服务端渲染，预计可去掉 fumadocs 浏览器运行时（约 167 KB）及其关联 chunk，总计约 680 KB。
2. **建真正的 `/blog/` 列表页**：目前 `/blog` 301 到 A1，是权宜之计；文章到 3 篇以上就应换成列表页（也是新内容的内部链接枢纽）。
3. **第 3 篇**：`Agent Harness vs MCP`，联想词已有明确对比意图；中文侧做 `智能体框架怎么选`。

> 注：Mermaid 图表为客户端渲染，SSR HTML 里只有容器占位，因此图表文本**不可被爬虫读取**。文章主体信息已全部在散文与表格中，图表仅作视觉汇总，并配有文字解读（「按三个环来读」），不依赖图表传达关键信息。

---

## 十、第三轮：减重 + 第三/四篇 + 列表页（2026-09-18）

### 10.1 文章页减重 597 KB（-37%）

**根因不在图表本身，而在 `mdx-components.tsx` 对 Mermaid 的静态 `import`。**

`getMDXComponents()` 是全站 MDX 页面的组件入口（6 个文档空间 + blog，共 500+ 页）。只要它对 `mermaid` 是静态导入，整条依赖闭包（chroma-js、rough.js、graphlib 等）就会进入**每一个** MDX 页面的预加载，即使正文一张图都没有。

修法：在本文件内改为 `lazy(() => import("../mermaid"))` + `Suspense`。图表本来就是客户端渲染，渲染时机不变。

实测效果（未压缩字节，含 CSS）：

| 页面 | 修复前 | 修复后 | 变化 |
|---|---|---|---|
| 文章页 | 46 assets / 1619 KB | 32 assets / 1020 KB | **-599 KB（-37%）** |
| 文档页（同享修复） | 含同一闭包 | 36 assets / 1131 KB | 同步下跌 |
| `/features/`（参照） | 31 / 942 KB | 31 / 936 KB | — |

验证：`chroma` / `rough` 在全部抽样页面的预加载里**计数为 0**；mermaid 成为独立按需 chunk（`mermaid-*.js` + `mermaid-parser.core-*.js`），动态引用存在于 browser chunk；含图页面仍有图表容器，无图页面确无。

文章页与营销页的体积差从 **679 KB 降到 84 KB**。剩余 84 KB 是 fumadocs 的 MDX 浏览器运行时（`browser-*.js`，约 89 KB）——作者本次**没有**去动它，因为改服务端渲染需要重构 6 个文档路由，波及 500+ 页，风险与本次收益不成比例。这是下一步的独立课题。

> 过程记录：作者第一次尝试是在 blog 路由里用 lazy 覆盖组件，**实测无效**（资源数反而 46→48），已完整回退；直到定位到 `mdx-components.tsx` 的静态导入才真正解决。^ 已回退的无效代码未保留。

### 10.2 第三篇：Agent Harness vs MCP

| 页面 | URL | 体量 |
|---|---|---|
| Agent Harness vs MCP: Different Layers, Not Rivals | `/en/blog/agent-harness-vs-mcp/` | 约 1400 词，11 个 H2 |
| Agent Harness vs MCP：不是竞争关系，是不同的层 | `/zh/blog/agent-harness-vs-mcp/` | 约 1700 汉字 |

核心论点：MCP 是**边缘的协议**，Harness 是**包裹 Agent 的运行时**，二者分层而非竞争。独有内容是**一次经 MCP 传入的工具调用的七步链路**，并逐段标注哪些归 MCP、哪些归 Harness（结论：很大比例是**治理**而非**连通性**）。另有「审计」与「多租户」两个场景说明边界在哪里显形。

### 10.3 第四篇：中文独有，智能体框架怎么选

| 页面 | URL | 体量 |
|---|---|---|
| 智能体框架怎么选：先分清三类东西，再看四个维度 | `/zh/blog/how-to-choose-an-agent-framework/` | 约 1500 汉字 |

**这篇是中文独有的，没有英文对应页。** 理由：中文用户搜「智能体框架选型 / 有哪些 / AI Agent 开发框架对比」，而英文侧对应的聚类（`agent framework`）在 Bing 联想词里**返回空**，强行配对会失真。产物里这页的 `hreflang` 计数为 **0** —— 不伪造语言配对。

内容：三类东西对比表（编排库 / 低代码平台 / Agent 运行时）→ 四个判断维度 → 九项选型清单 → 三个常见误区。

### 10.4 `/blog/` 列表页上线

文章达到 3 篇后，裸 `/blog` 单向 301 到首篇已不合理。新增 `/en/blog/` 与 `/zh/blog/` 列表页（`app/routes/blog/index.tsx`），排序采信各语言 `meta.json` 的 pages 顺序（阅读顺序），不再引入手工维护的权重字段。

`_redirects` 相应改为 `/blog` → `/en/blog/`（不再是 301 到首篇）。sitemap 里列表页不在 MDX 扫描范围内，因此手工声明了一对带双向 hreflang 的条目。

**顺带避开一个坑**：`<Link to>` 会把 `/en/blog/x/` 归一化成不带尾斜杠的形式，而 canonical 带尾斜杠，会造成每次点击多一跳 308。列表页改用原生 `<a href={normalize_site_path(page.url)}>`，href 与 canonical 完全一致（已验证 7 条链接均带尾斜杠）。

### 10.5 验证结果

- 完整重建：**562 个 HTML**（+5），exit 0；`test:seo` **13/13**；`tsc --noEmit` **exit 0**
- 9 个 blog 页面：列表页与 A1–A3 均 `h1=1`、`hreflang=3`、`index, follow`、`BlogPosting`（列表页无 JSON-LD，属预期）；A4 为 `hreflang=0`（中文独有，正确）
- sitemap：**554 条**（+5），列表页带双向 hreflang；**A4 只有自身的 `zh-CN`**，未伪造英文对
- 全 9 页内链校验：除预存的 `/download/macos`（Cloudflare Function）外无失效
- 图表容器：仅出现在 A2、A3（应含图），A1、A4 确无
- 写作规范：英文三篇 `em_dash=0`、无禁用词；中文的 `——` 是中文标准破折号（双字长），非 AI 特征，不作修改

### 10.6 待办更新

1. ~~文章页减重~~ → **已完成**（-597 KB）。剩余 84 KB（fumadocs MDX 浏览器运行时）需改服务端渲染，属独立课题。
2. ~~建 `/blog/` 列表页~~ → **已完成**。
3. **接入 GSC** —— 四轮未做。四篇文章已上线，但没有数据能告诉你哪篇排上了。
4. 下一篇候选：`The Anatomy` 可再拆一篇「Session 持久化怎么做」；中文侧可做「多智能体编排」或「Agent 记忆 vs RAG」。



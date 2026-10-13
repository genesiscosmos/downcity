# Homepage SEO 与品牌内容方案

日期：2026-10-12
状态：源码复核与文案建议；不修改页面、不部署。承接 2026-10-10 SEO 复核与已认可的 Builder 价值定位。

## 1. 范围与结论

首页任务是让搜索引擎与 Builder 清楚理解 Downcity 的品类、适用人群、用户收益及开始路径。双应用集成测试不是本轮 SEO 的前置条件。

本次读取当前首页路由、定位文案、SEO 工具、预渲染配置、Hero 的标题代码及历史审计。未重新读取线上 HTML，未运行构建、性能或索引检查；不能把本次源码观察当作线上状态。

已有 title、description、canonical、hreflang、结构化数据组件和预渲染配置。当前优先处理的是内容层级与用户价值表达，并保留历史审计中线上一致性的待核验项。

## 2. 问题诊断—优化方案—预期效果

| 优先级 | 问题诊断 | 优化方案 | 预期效果与验收 |
|---|---|---|---|
| P1 | 定位文案以运行 Agent、产品化 Kit 为主，已认可的 Builder 能力价值未进入首页文案 | 首屏明确 Builder 能构建什么；下一句定义开源 Agent 基础设施 | 首屏可回答是什么、给谁用、能做什么；不承诺排名涨幅 |
| P1 | “Build worlds…” 抽象；Hero 源码显示它是 H1 下的段落，不能误判它就是 H1 | 将抽象品牌段替换为明确用户收益；H1 是否调整需连同 `hero.title` 实际翻译核对 | 标题、说明和产品定义分工清楚，保留唯一明确主标题 |
| P1 | 历史审计记录线上文本与源码区块可能不一致；本次未重验 | 发布前对照线上原始 HTML、批准版本与构建产物 | 首屏、定义区、CTA 与内链进入可抓取 HTML；不能以提取遗漏断言故障 |
| P2 | Agent Productization Kits 是产品自定义表达，暂无搜索需求证据 | 品类以 open-source agent infrastructure / agent harness / agent runtime 表达；Kit 留作机制解释 | 更直接匹配产品发现意图；不把关键词次数设为目标 |
| P2 | 首页概念解释可能掩盖使用收益 | 在定义区前后加入短的用户收益说明，详细概念交给文章 | 用户能理解选择理由，知识内容获得相关内链 |
| P2 | “reliable / scale / recovery” 等能力措辞需要实现边界，不能从口号推导结果 | 用对应文档与源码说明已具备机制；未验证成果不量化 | 能力卡片可追溯，避免一键运营、天然隔离与提效倍数 |

## 3. 关键词与页面职责

以下按意图与产品相关性初排，不代表搜索量已验证。

| 优先级 | 查询方向 | 搜索意图 | 首页职责 |
|---|---|---|---|
| P1 | Downcity / Downcity AI | 品牌导航 | 明确产品定义与开始入口 |
| P1 | open-source agent infrastructure / agent harness | 产品发现、方案评估 | Title、定义与核心能力自然覆盖 |
| P1 | 开源智能体基础设施 / 智能体运行时 | 中文产品发现 | 中文元信息和正文承接 |
| P2 | agent runtime / build agent applications | 技术选型、开发方案 | 能力说明及产品、文档内链 |
| P2 | what is an agent harness / Agent Harness 是什么 | 概念学习 | 首页短定义，主内容交给定义文章 |
| P3 | agent harness vs MCP / framework | 比较选型 | 相关比较文章，不塞进首页主标题 |

Google 不把 meta keywords 作为排名依据；无需围绕该标签继续优化。百度应独立观察中文查询、收录与大陆访问体验；hreflang 不能代替中文正文质量，也不要求为了百度强行迁移 URL。

## 4. 首屏建议稿（待批准）

### 英文

- 品类说明：Open-source agent infrastructure
- 主标题方向：Build your own system of agent applications.
- 描述：Downcity gives independent builders and small teams the runtime, tools, and interfaces to build and manage agent applications — with a reusable foundation for what comes next.
- 产品机制补充：Start with an Agent Harness. Add City, Federation, SDKs, and UI kits as your application needs them.
- 主 CTA：Get started
- 次 CTA：View on GitHub

### 中文

- 品类说明：开源 Agent 基础设施
- 主标题方向：构建你自己的 Agent 应用体系。
- 描述：Downcity 为独立 Builder 和小团队提供运行时、工具与界面基础，帮助你构建和管理 Agent 应用，并为下一次构建积累可复用的能力。
- 产品机制补充：从 Agent Harness 开始，按应用需要接入 City、Federation、SDK 与 UI。
- 主 CTA：开始构建
- 次 CTA：查看 GitHub

这是信息清晰度优先的首稿，不是“性感标题”的最终定稿。“体系”必须由后文的具体收益解释，不能仅靠大词。

### 元信息建议

英文 Title：Downcity — Open-Source Agent Harness & Infrastructure

英文 Description：Build and manage agent applications with Downcity: an open-source agent harness, shared services, SDKs, and UI kits for independent builders and small teams.

中文 Title：Downcity｜开源智能体运行时与 Agent 应用基础设施

中文 Description：Downcity 为独立开发者和小团队提供开源智能体运行时、共享服务、SDK 与 UI，帮助你构建和管理自己的 Agent 应用，并复用已有基础。

Title 和 Description 以准确、可读及实际搜索展示宽度为准，不机械执行固定字符数。Description 影响摘要与点击表达，不是直接排名保证；搜索引擎可能重写。

## 5. 首页内容结构

不需要先重做交互设计，优先在现有区块内重排信息与替换文案。

1. **Hero：**品类、用户价值、开始入口；避免先要求理解 City / Federation。
2. **Quick Start / SDK：**解释第一个可做的事情，提供准确安装与文档路径；移动端避免交互演示挡住开始入口。
3. **用户收益：**三个短项——构建自己的应用；组织运行与资源；让适合共享的能力进入下一次构建。不要把“持续运行”当成最终收益。
4. **产品机制：**Harness 负责执行基础；City 组织运行资源；Federation 连接共享服务；SDK / UI 接入应用。各项链接到实际文档，边界以实现为准。
5. **使用场景：**项目助手、材料整理、稿件审查等须标注为场景方向或真实示例；没有运行证据不称成功案例，不添加虚构客户。
6. **品类定义与 Learn：**短答什么是 Agent Harness，链接定义、架构与比较文章；避免首页和文章竞争完整信息意图。
7. **最终 CTA：**再次给出开始构建与文档入口，不把所有路径导向抽象白皮书。

## 6. 发布前验收与效果观察

技术验收：中英首页返回正常页面；原始 HTML 中有首屏正文；主标题结构明确；self canonical 和对应语言链接正确；JSON-LD 与可见内容一致；重要内链指向最终有效 URL。运行项目现有构建与 SEO 测试，不能将源码存在视为验收通过。

体验验收：移动端无需完成滚动动画也能读到产品定义与主 CTA。现场性能参考第 75 百分位 LCP ≤ 2.5s、INP ≤ 200ms、CLS ≤ 0.1；没有数据时标为待测。

效果基线：记录发布前后各 28 天品牌/非品牌曝光、点击、CTR、首页落地访问及 Quick Start / GitHub CTA 点击。新站或低流量站延长观察期；按相近查询和地区比较，标记季节性及其他改动。不开出无数据支撑的流量提升比例。

## 7. 三个行动项

1. 批准首屏的品类、价值与元信息方向，再改集中定位源及必要翻译，不先做运行案例。
2. 把首页能力与收益逐项对应，并补齐文档内链；保留已有技术 SEO 基础。
3. 实施前后核验线上 HTML、索引与转化基线，再据实际数据迭代。

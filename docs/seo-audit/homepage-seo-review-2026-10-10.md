# Homepage SEO 状态复核与待办

- 日期：2026-10-10
- 状态：诊断记录；未修改网站、未部署。
- 范围：homepage 源码、线上首页与 sitemap 的文本读取；不是全站爬虫审计。
- 本文是本次复核的增量记录，不替代同目录 2026-09 的历史审计。

## 执行摘要

技术基础较完整：预渲染、统一 SEO 元信息、多语言 URL、sitemap、结构化数据组件和构建产物回归测试均有实现。主要待办是确认线上发布一致性、强化搜索意图与真实使用证据、建立效果基线。没有 GSC、性能和外链数据，不能据此判断排名或给出健康评分。

## 证据与边界

已读取：`private/apps/homepage/app/routes/home.tsx`、`private/apps/homepage/app/lib/seo.ts`、`private/apps/homepage/app/lib/homepage-positioning.ts`、`app/root.tsx`、`react-router.config.ts`、`public/robots.txt`、`scripts/seo-ready.test.mjs`，以及 https://downcity.ai/ 、https://downcity.ai/sitemap.xml 。

线上使用文本提取，不等同于完整 HTML / DOM 检查。无法以文本提取缺失断言 JSON-LD 或区块不存在。本次 Shell 执行失败，SEO 测试未成功运行；没有新增通过结果。没有验证线上 canonical、状态码链、结构化数据有效性、移动端 CWV 或索引状态。

## 已有基础

| 项目 | 证据 | 结论边界 |
|---|---|---|
| 渲染 | React Router SSR 与营销、文档、博客预渲染配置；线上可读正文 | 具体发布产物仍需验证 |
| 元信息 | create_page_meta 集中生成 title、description、canonical、OG、Twitter | 代码存在不等于所有线上页正确 |
| URL 规范 | apex HTTPS、HTML 尾斜杠、内链规范化函数 | 尚未全面抓取重定向与内链 |
| 国际化 | 中英 self canonical 与 hreflang 逻辑；线上 sitemap 有 alternate | 需核验互链、200、canonical 一致性 |
| Robots | 本地允许公开页面，排除内部数据与 API | 尚未检查线上响应 |
| 结构化数据 | 首页引入 HomeStructuredData | 未完成渲染检查或验证器验证 |
| 回归测试 | test:seo 检查构建产物 | 本次未运行成功 |

## 问题清单：诊断—方案—预期效果

### SEO-01：源码与线上文本存在差异

- 优先级：P1；潜在影响：高；状态：待核验。
- 诊断：本地首页包含 Quickstart、Definition、Learn 组件；线上本次文本提取未出现定义段与 Go deeper 区域。可能是版本未部署、构建版本不同或提取遗漏，不能直接断言部署故障。
- 方案：对照线上原始 HTML 与渲染 DOM；核对发布提交；用项目现有 pnpm 流程构建并运行 test:seo。增加定义正文和学习链接的构建产物断言。
- 验收：确认线上与批准发布版本一致；定义、学习区及真实文章链接可被抓取；构建与 SEO 测试通过。
- 预期效果：让已有内容优化真正进入公开页面，避免源码与线上脱节。

### SEO-02：产品价值缺少足够具体的证据

- 优先级：P2；潜在影响：中高；状态：内容建议，等待品牌方向确认。
- 诊断：线上有六项能力和四类 City 场景，但多数为概括描述，尚不足以证明典型使用结果。
- 方案：补充 2–3 个真实可复现示例，说明输入、执行、权限边界与产物；能力段链接到对应教程。不要虚构客户、节省时间或性能数据。
- 验收：每个案例有可运行示例或真实产物；主要 CTA 指向 Quick Start / 安装路径。
- 预期效果：增强意图匹配和使用转化，不承诺具体排名或流量增幅。

### SEO-03：关键词与页面职责需要明确分工

- 优先级：P2；潜在影响：中高；状态：待数据校验。
- 诊断：Agent Productization Kits 可表达差异，但暂无搜索量证据。首页不宜同时承担产品选择、概念解释与所有实现问题。
- 方案：按下表建立关键词映射，再用 GSC 和关键词工具确认需求；检查同主题页面是否竞争。

| 优先级 | 方向 | 意图 | 承接 |
|---|---|---|---|
| P1 | open-source agent harness / agent runtime | 产品发现 | 首页、产品页，分别明确职责 |
| P1 | Downcity / Downcity SDK | 品牌导航 | 首页、SDK 文档 |
| P1 | what is an agent harness | 概念学习 | 定义文章 |
| P2 | agent harness vs MCP / framework | 选型与区别 | 比较文章 |
| P2 | persistent agent sessions / permissions | 实现问题 | 能力教程 |
| P2 | 开源智能体运行时 / Agent Harness 是什么 | 中文发现与学习 | 中文产品页、文章 |

- 验收：每个核心查询簇有明确主页面与正文内链；优先级基于需求、产品匹配及转化数据调整。
- 预期效果：减少意图混杂，形成产品—知识—教程的内容关系。

### SEO-04：性能尚未实测

- 优先级：P2，若实测严重不达标则上调；潜在影响：待测。
- 诊断：首页可视化交互、Google Fonts 多字重和第三方脚本是风险点，不是已确认性能故障；大陆字体可达性需单独测试。
- 方案：移动端 PSI / Lighthouse 实验室测试结合 CrUX 或真实用户数据；定位后再优化字体、首屏 JS 与资源加载。
- 验收参考：第 75 百分位 LCP ≤ 2.5s、INP ≤ 200ms、CLS ≤ 0.1；无现场数据时明确标注。
- 预期效果：改善加载与交互体验，不以单次实验室分数代替真实表现。

### SEO-05：收录、结构化数据与转化缺少验证闭环

- 优先级：P1；潜在影响：高；状态：需要数据与验证。
- 诊断：没有 GSC、百度站长数据、自然流量基线、安装转化或外链数据；线上 JSON-LD 未验证。
- 方案：GSC URL 检查首页与中文首页；检查选择的 canonical、索引与 sitemap；浏览器检查 JSON-LD 并结合 Schema Validator / Rich Results Test 验证。后者不支持所有 schema 类型，不出现富结果不等于 schema 无效。
- 验收：形成近 28 天品牌/非品牌查询、点击、曝光、CTR、目标页面和 Quick Start 转化基线；记录索引问题。
- 预期效果：从推测转向可验证的优化决策。

## 不应误判的事项

- 首页 H1 对应 Agent Harness + Agent Productization Kits，不是只有 Build worlds 品牌口号。
- meta keywords 不值得继续作为 Google 优化重点。
- 有 sitemap 不等于已收录；有结构化数据不保证富结果或排名。
- 英文首页位于根路径、中文位于 /zh/ 是可用方案，不必为统一前缀强制迁移。
- 不按固定字数或关键词次数堆砌正文；title / description 应按可读性和显示宽度判断。
- 百度需独立检查抓取、中文检索需求与大陆访问体验，不能直接套用 Google 结论。

## 后续顺序

1. 核对线上版本、实际抓取信号和索引状态。
2. 确认品牌定位后再调整正文、案例、内容内链及页面职责。
3. 建立 GSC、性能和转化基线，按实际问题排序实施。

本阶段仅记录，不执行网站内容修改、发布或配置变更。

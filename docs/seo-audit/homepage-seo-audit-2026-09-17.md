# Downcity Homepage SEO 现状审计与优化方案

> 审计日期：2026-09-17（Asia/Shanghai）
> 审计方式：源码审查 + 本地构建产物（`homepage/build/client`，2026-09-10 构建）实测 + 项目自带 `test:seo` 回归测试（8/8 通过）
> 站点：https://downcity.ai （React Router 7 SSR + Cloudflare Pages 预渲染，中英双语，508 个 MDX 文档页）

---

## 一、现状总评

**结论：技术 SEO 基建完成度高（约 80 分），当前最大的短板不在技术层，而在「内容覆盖」与「可抓取信号的深度」。**

已有基建（实测验证通过）：
- ✅ 全站 canonical（apex 域名 + 尾斜杠规范）、robots.txt、543 条 URL 的 XML sitemap（含 hreflang）
- ✅ OG / Twitter Card 元信息，`create_page_meta` 统一出口
- ✅ 首页 Organization + WebSite + SoftwareApplication JSON-LD，品牌实体锚定 genesiscosmos.com
- ✅ 508 个 MDX 文档页全部预渲染为静态 HTML（对 Google 十分友好）
- ✅ 中英文双版本，x-default 指向英文
- ✅ 静态 404 页 noindex，npm 包 `homepage` 字段指回官网（外链信号入口）
- ✅ 已有 `pnpm test:seo` 构建产物回归测试，SEO 不容易悄悄回归

---

## 二、问题清单（按严重程度排序）

### P0-1：预渲染 HTML 中 hreflang 属性名错误 —— 实际失效

**问题诊断**

`app/lib/seo.ts` 中使用了 JSX 风格驼峰写法：

```ts
{ tagName: "link", rel: "alternate", hrefLang: "en", href: english_url }
```

React Router 的 `meta` 返回的 `hrefLang` 被原样序列化进 HTML，导致构建产物中实际输出为：

```html
<link rel="alternate" hrefLang="en" href="https://downcity.ai/" />
```

**这是驼峰属性名泄漏，不是合法的 HTML 属性**。HTML 属性不区分大小写，但 Google 解析的是属性名字面量，`hrefLang` 无法匹配标准 `hreflang` 属性选择器。实际效果：**全站 HTML 页面的 hreflang 注解全部失效，只有 sitemap 里的 hreflang 还在工作**。

同时暴露出回归测试盲区：`seo-ready.test.mjs` 用 `html.includes('href="..."')` 断言"双向 hreflang 存在"，只验证了 `href` 值存在，没有验证属性名正确，所以 8/8 全绿但 bug 漏网。

**优化方案**

1. `app/lib/seo.ts`：把 `hrefLang` 改为小写 `hreflang`（若 React Router 拒绝，改用 `{ tagName: "link", rel: "alternate", hreflang: ... }` 不可行时，在 `Layout` 的 `links` 函数或手写 head 标签输出）。
2. 同步修正 `scripts/seo-ready.test.mjs`：将断言从 `html.includes(href=...)` 改为 `/hreflang="en"/i` 且排除 `hrefLang`（正则上强制小写）。
3. 全站 HTML 页面统一复验：`grep -r 'hrefLang=' build/client --include='*.html'` 必须为 0 条。

**预期效果**

中英文页面互相关联信号恢复生效，zh 页面在中文搜索区域的语言定位权重恢复；测试堵住此类回归。

---

### P0-2：`/zh/` 首页 title 与英文完全相同，中文搜索无差异化竞争力

**问题诊断**

实测产物：

```
/     → <title>Downcity — Agent Harness + Agent Productization Kits</title>
/zh/  → <title>Downcity — Agent Harness + Agent Productization Kits</title>  ← 完全相同
```

`homepage-positioning.ts` 里 `zh.meta_title` 就是英文文案的复制。`meta_description` 虽然是中文，但 title 是权重最高的 on-page 因素。中文用户在百度/Google 中文搜"agent harness"、"agent 产品化"等词时，这个 title 没有任何优势，还会被搜索引擎判定为疑似重复内容。

**优化方案**

`homepage-positioning.ts` 的 `zh` 部分改为差异化中文 title，建议格式：`Downcity — 开源 Agent 运行时与产品化 Kit（Agent Harness）`，控制在 30 个汉字以内；同时审视 zh 页面 H1 后的 hero 副标题是否自然包含中文目标关键词。

**预期效果**

中文搜索结果中品牌词 + 品类词完整展示，zh 页面重复内容风险消除。

---

### P1-1：部分营销页未开启 `localized`，hreflang 覆盖不全

**问题诊断**

`app/root.tsx` 与多数营销页路由的 `create_page_meta(...)` 都**没有传 `localized: true`**（只有 `home.tsx` 传了）。而预渲染列表里明明有 `/whitepaper`、`/zh/whitepaper` 等双语对。实测 `/whitepaper/`、`/product/` 等 URL 的 HTML 里 hreflang 只有 3 条（en/zh-CN/x-default 自我声明），缺 canonical 对页声明的问题不大，但语言集声明不完整。

**优化方案**

给所有双语存在的营销路由统一传 `localized: true`；或重构 `create_page_meta`：按预渲染路径表自动判断双语对，路由层不再手工维护该开关。

**预期效果**

hreflang 信号与 sitemap 完全一致，双语收录映射关系稳定。

---

### P1-2：og:image 用 512×512 方形图，社交分享卡片质量差

**问题诊断**

`create_page_meta` 默认 `image_pathname = "/social-icon.png"`，实测文件为 512×512 PNG。微信/X/LinkedIn/Google Discover 的最佳卡片是 1200×630（1.91:1）。项目里已有现成的 `og-image.png`（1200×630）却没被默认引用。

**优化方案**

1. `seo.ts` 默认 `image_pathname` 改为 `/og-image.png`，`twitter:card` 改为 `summary_large_image`。
2. 预估点击率提升：社交分享场景 CTR 通常可提升 20–50%（经验值，需以实际分享数据验证）。

**预期效果**

分享到 X / Telegram / 微信 / LinkedIn 的链接卡片出现完整品牌横幅，提升点击。

---

### P1-3：`llm.txt` 是空壳，AI 搜索引擎（ChatGPT/Perplexity）引用入口缺失

**问题诊断**

`homepage/llm.txt` 源文件内容只有 `# DOWNCITY` 一个标题行，且构建产物中没有输出。GPTBot、PerplexityBot、ClaudeBot 等爬虫日益重要，对开发者工具类站点，被 AI 引用能带来高质量技术受众。

**优化方案**

生成标准 `llms.txt`（注意复数命名是社区惯例）：站点一句话定位、核心产品链接、Quick Start 链接、文档地图（六大文档区各自入口）、GitHub 仓库。放到 `public/llms.txt` 直接静态输出，并在 robots.txt 注释引用。

**预期效果**

AI 搜索与对话式引用有结构化入口；成本半天以内。

---

### P1-4：FAQ 页没有 FAQPage 结构化数据；文档页缺 BreadcrumbList

**问题诊断**

- `community/faq` 双语页面均无 `FAQPage` JSON-LD —— 这是门槛最低的富结果机会。
- 508 个文档页无 `BreadcrumbList` —— 文档站是最典型的面包屑场景，Google 搜索结果当前只能展示纯 URL。

**优化方案**

1. FAQ 内容数据化（问题/答案数组），渲染层与 JSON-LD 同源输出。
2. Fumadocs 文档布局组件中按 `page.slugs` 输出 BreadcrumbList JSON-LD（position + name + url）。

**预期效果**

FAQ 页有机会获得富结果展示；文档页搜索结果展示面包屑路径，提升结果信任度与点击率。

---

### P2-1：`/docs` 无前缀入口是 noindex 重定向页（合理，但需确认内链指向）

**问题诊断**

`/docs/index.html` 为 `noindex` + JS 重定向页（兼容旧链接，合理）。需确认：站内所有导航、footer、README、npm 包 README 中指向文档的链接统一使用 `/en/docs/...` 或 `/zh/docs/...` 最终形态，避免爬虫在内链层浪费抓取预算。

**优化方案**

全站内链审计（导航、Footer、首页 Quick Start 卡片、GitHub README、npm README）。

**预期效果**

抓取预算集中于 543 个 canonical URL，无中转损耗。

---

### P2-2：文档 title 模式单薄，长尾关键词覆盖不足

**问题诊断**

抽查：`<title>Agent — Downcity Docs</title>`。只有一级栏目名 + 品牌词，未利用页面具体主题。508 个文档页是最大的自然流量金矿，每页 title 都是"具体主题 + 价值词"的最佳载体。

**优化方案**

文档 meta 改为：`{页面主题} · {栏目} — Downcity Docs`（如 "City Runtime Concepts · City SDK — Downcity Docs"）。同时核对 Fumadocs frontmatter 中 description 是否逐页有值，缺的补齐。

**预期效果**

长尾词（如 "agent runtime concepts"、"city sdk federation"）的覆盖面显著扩大；508 页逐页生效。

---

### P2-3：缺数据反馈闭环（GSC / Bing / 百度站长平台未接入信号）

**问题诊断**

仓库内无 Google Search Console / Bing Webmaster / 百度站长平台的验证与提交痕迹。没有数据，后续所有优化都是盲打。

**优化方案**

1. GSC 添加资源（Domain 或 URL prefix），上传 sitemap，验证首页 HTML 加验证 meta（可走 `create_page_meta` 或 `Layout` head）。
2. Bing Webmaster Tools 同步（可直接从 GSC 导入）。
3. 百度站长平台：重点提交 `/zh/` 与 `/zh/docs/` 路径；中文文档内容对百度有独立价值。
4. 之后每两周做一次 GSC 效果报表复盘：曝光 → 点击 → 平均排名，找"曝光高但点击低"的页面优先改 title/description。

**预期效果**

2–4 周内拿到真实的查询词、排名与点击数据，作为内容策略的决策依据。

---

## 三、内容与外链策略（技术之外的增量）

| 动作 | 说明 | 优先级 |
|---|---|---|
| 关键词矩阵 | 围绕 "agent harness"、"agent productization"、"agent runtime"、"city sdk"、"agent sdk quickstart" 建关键词表；判断搜索意图（学习型 vs 采购型）后映射到文档页与营销页 | 高 |
| 术语页（词表落地页） | 为 "what is an agent harness"、"agent vs chatbot pipeline" 等概念词创建独立 glossary 页，承接科普型搜索意图 | 中 |
| npm/GitHub 外链闭环 | 每个 npm 包 README 头部放官网链接 + Quick Start；GitHub 仓库 About、README、Discussion 置顶链接 | 高 |
| 技术社区分发 | dev.to / 掘金 / V2EX / Hacker News Show HN，每次发版同步一篇带官网链接的技术长文 | 中 |
| benchmark/对比页 | "Downcity vs 自建 agent 运行时" 类采购意图页面，转化价值最高 | 中 |

---

## 四、执行节奏建议

**第 1 周（技术修复）**：P0-1 hreflang 修复 + 测试加固 → P0-2 zh title 差异化 → P1-2 og:image。
**第 2 周（信号接入）**：GSC/Bing/百度站长平台接入 + sitemap 提交；llms.txt 上线。
**第 3–4 周（深度建设）**：FAQPage / BreadcrumbList 结构化数据；文档 title 批量优化；内链审计。
**第 2 个月起（内容增长）**：关键词矩阵 → 内容生产 → 外链分发，按 GSC 数据滚动调整。

---

## 五、最关键的 3 个行动项

1. **修复 `app/lib/seo.ts` 中 `hrefLang` → `hreflang`，并同步加固 `seo-ready.test.mjs` 的断言**（当前全站页面级 hreflang 实际失效，这是唯一的真 bug，工作量 30 分钟）。
2. **给 `/zh/` 首页写差异化的中文 title**（当前与英文完全相同，中文搜索无竞争力，工作量 15 分钟）。
3. **接入 Google Search Console 并提交 sitemap**（后续一切数据驱动优化的前提，工作量 30 分钟）。

---

## 六、修复记录（2026-09-17 已完成前三项）

> 修改均通过完整构建 + 强化后的 `pnpm test:seo`（10/10 通过）+ `tsc --noEmit` 验证，
> 并直接抽查了构建产物 HTML。

| # | 文件 | 修改 | 产物验证结果 |
|---|---|---|---|
| 1 | `app/lib/seo.ts` | `hrefLang` → 小写 `hreflang`（附成因注释）；默认 `og:image` 改 `/og-image.png`；`twitter:card` 默认改 `summary_large_image` | 全站 550+ 页 HTML 输出 `<link rel="alternate" hreflang="en\|zh-CN\|x-default">`，驼峰残留 0 条；og:image 1200×630 |
| 2 | `app/lib/homepage-positioning.ts` | zh `meta_title` 差异化为 `Downcity — 开源 Agent Harness 与 Agent 产品化 Kit` | `zh/index.html` title 含中文品类词，与英文 title 不再重复 |
| 3 | `scripts/seo-ready.test.mjs` | ① canonical/hreflang 断言改用精确正则 + 强制小写属性名；② 新增 8 个营销页的驼峰 `hrefLang` 反向扫描；③ 新增「中英文首页 title 差异化」测试；④ 新增「默认分享图用横图」测试；测试数 8 → 10 | 旧产物会红、新产物全绿，回归已堵住 |

验证命令（本机可复现）：`cd homepage && pnpm build && pnpm test:seo`

---

## 七、第二轮优化记录（2026-09-17，P1-3 / P1-4 已完成）

> 全部通过完整重建（client + server）+ 强化后 `pnpm test:seo`（13/13）+ `tsc --noEmit`
> 验证，并直接抽查了构建产物 HTML。

### 7.1 llms.txt 上线（P1-3）

| 文件 | 说明 |
|---|---|
| `public/llms.txt`（新增） | 遵循 llms.txt 社区惯例：一句话定位 + Product/Documentation/Community 三段链接地图，覆盖中英文文档入口与 GitHub 仓库 |
| `llm.txt`（删除） | 旧空壳文件（仅一行标题，无构建引用），避免与 `llms.txt` 混淆 |
| 新增测试 | llms.txt 进入构建产物且包含中英文文档入口与仓库链接 |

### 7.2 FAQ 页深度修复（P1-4 前半）

审计中实测发现两个比缺 JSON-LD 更严重的问题，一并修复：

1. **zh FAQ 页 SSR 预渲染成英文**：i18next 单例固定 `lng: "en"`，`useTranslation()` 在服务端拿不到路径语言。修复：从 URL 推导语言并显式传 `lng` 给所有 `t()` 调用。
2. **答案文本完全不在预渲染 HTML 中**：手风琴收起时答案是条件渲染（`openId === faq.id ? ... : null`）。修复：答案始终渲染进 DOM，收起态仅用 `hidden` 类切换可见性。

在此基础上输出 FAQPage JSON-LD，与页面可见文本同源同语言。测试断言：en 页含英文问答、zh 页含中文问答且互斥、JSON-LD 8 条与可见文本一致。

### 7.3 文档页 BreadcrumbList JSON-LD（P1-4 后半）

| 文件 | 说明 |
|---|---|
| `app/lib/doc-breadcrumb.ts`（新增） | 从 Fumadocs 页面树构建面包屑：优先采信树内可见名称，缺失时回退 slug 兜底名；集合根层名称用固定映射表（Docs/文档、City SDK、Payments 等），与导航一致 |
| 6 个 `*/page.tsx` | 面包屑在 **loader 内**序列化为最终 JSON 字符串后返回——页面树不进入 loader 返回值，避免被 React Router 序列化进每个文档页的客户端载荷（实测该方案曾使页面从 81.8KB 膨胀到 87.5KB；现控制在 82.7KB） |
| 新增测试 | 4 个代表性页面面包屑 ≥2 层、position 连续、URL 规范、最后一层等于页面 canonical；集合根页恰好单层指向自身，全站禁止空 `itemListElement` |

覆盖：478 个文档页全部输出 BreadcrumbList，空面包屑 0 条。

### 7.4 环境备注（不影响项目）

sandbox 中 pnpm 全量重装两次挂起且清掉了部分 linux-arm64 native binding（rolldown/rollup/lightningcss/@tailwindcss/oxide），已手动从 npm registry 恢复对应二进制完成构建。本机正常 `pnpm install` 即可，无此问题。

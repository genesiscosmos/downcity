# Downcity Homepage SEO 第二轮审计与修复（2026-09-18）

> 审计日期：2026-09-18（Asia/Shanghai）
> 上一轮：[`homepage-seo-audit-2026-09-17.md`](./homepage-seo-audit-2026-09-17.md)
> 审计方式：**线上实测**（`curl` 直读 https://downcity.ai 真实响应，非本地产物）+ 源码核对 + 本地重建逐项复验
> 线上原件：[`live-snapshots/2026-09-18/`](./live-snapshots/2026-09-18/README.md)（当天抓到的原始 HTML 响应）
> 站点：React Router 7 + Cloudflare Pages 预渲染，中英双语

---

## 一、结论先说：三个结论

1. **上一轮的全部修复在线上都还没生效。** 仓库领先 `origin/main` 18 个提交，线上跑的仍是旧版本。
2. **本轮发现一个比上一轮所有问题都更严重的缺陷：整个 `/zh/**` 营销站点被预渲染成了英文正文。** 中文站实际上没有中文内容。
3. 本轮修掉了 4 个 404 类缺陷、4 类 on-page 缺陷，并修复了上面第 2 条（15 个文件）。

---

## 二、P0-0：`/zh/**` 全部预渲染成英文正文（本轮最严重）

### 问题诊断

线上实测 `cjk / (cjk + latin)` 字符比（`cjk ≈ 81` 是导航与页脚的中文外壳，正文部分全是英文）：

| URL | cjk | latin | cjk 占比 | 判定 |
|---|---|---|---|---|
| `/zh/whitepaper/` | 81 | **4351** | 0.02 | 整篇中文白皮书页面是英文正文 |
| `/zh/features/` | 81 | 2334 | 0.03 | 英文 |
| `/zh/product/` | 81 | 1650 | 0.05 | 英文 |
| `/zh/start/` | 81 | 1672 | 0.06 | 英文 |
| `/zh/product/sdk/` | 81 | 1118 | 0.07 | 英文 |
| `/zh/product/agent-sdk/` | 81 | 1058 | 0.07 | 英文 |
| `/zh/product/ui-sdk/` | 81 | 975 | 0.08 | 英文 |
| `/zh/community/faq/` | 81 | 580 | 0.12 | 英文 |
| `/zh/community/roadmap/` | 81 | 597 | 0.12 | 英文 |
| `/zh/resources/hosting/` | 81 | 552 | 0.13 | 英文 |
| `/zh/` | 677 | 667 | 0.50 | ✅ 正常（首页已迁移） |

实测正文（`/zh/product/` 的 `<h1>`）：

```html
<h1>Agent infrastructure products for AI builders</h1>
```

而源码里这句话的中文版是「给 AI builders 的 Agent 基础设施产品矩阵」。

### 根因（精确到文件）

`i18next` 单例在 `app/lib/locales/index.ts` 中固定 `lng: "en"`，语言只由 `root.tsx` 的 `useEffect` 在浏览器端切换。因此**服务端预渲染时 `i18n.language` 永远是 `en`**。

上一轮已经为 `community.faq.tsx` 修过这一个 bug（审计文档 7.2 节：「i18next 单例固定 lng: "en"，useTranslation() 在服务端拿不到路径语言」），但**同类写法在其余 15 个文件里仍然存在**：

```
components/sections/CTASection.tsx          i18n.language === "zh"
components/sections/CodePreviewSection.tsx  i18n.language.startsWith("zh")
components/sections/WhitepaperSection.tsx   i18n.language.startsWith("zh")
components/sections/StartGuideSection.tsx   i18n.language.startsWith("zh")
components/sections/CommunitySection.tsx    i18n.language.startsWith("zh")
components/sections/FeaturesSection.tsx     useTranslation() 的 t
routes/product/index.tsx                    i18n.language.startsWith("zh")
routes/product/sdk.tsx / agent-sdk / ui-sdk i18n.language.startsWith("zh")
routes/community.roadmap.tsx                useTranslation() 的 t
routes/community.showcase.tsx               i18n.language.startsWith("zh")
routes/resources.skills.tsx                 useTranslation() 的 t
routes/resources.hosting.tsx                useTranslation() 的 t
routes/resources.examples.tsx               useTranslation() 的 t
routes/resources.use-cases.tsx              useTranslation() 的 t
```

首页那批组件（`Home*Section`、`Footer`、`navbar`）早已迁移到 URL 派生的 `use_interface_locale()`，所以只有 `/zh/` 是正常的——**这正是问题长期没被发现的原因**：抽查首页一切正常。

### 为什么这是最严重的 SEO 问题

1. **中文搜索等于零内容**。`/zh/**` 有约 30 个 URL 进了 sitemap、声明了 `hreflang="zh-CN"`，但正文是英文。中文用户搜「Agent 运行时」「智能体产品化」，站点没有任何中文内容可以匹配。
2. **hreflang 集群被自己削弱**。中英两版正文近乎相同，只在导航外壳上不同。Google 面对两个内容几乎一致的 URL 会自行选择 canonical，hreflang 声明的价值随之崩塌。
3. **`/zh/whitepaper/` 与 `/whitepaper/` 是 4351 字符的完全重复内容**，属于「Duplicate, Google chose different canonical」的典型样本。
4. 这不是部署问题，而是**代码里就存在的缺陷**——推送部署后依然存在（除非一起修）。

### 优化方案（本轮已实施）

统一改为从 URL 取语言：

- 只做翻译的组件：`const { i18n } = useTranslation(); const t = i18n.getFixedT(use_interface_locale());`
- 只在本地 COPY 对象里二选一的组件（Whitepaper / StartGuide / Showcase）：直接 `const locale = use_interface_locale();`，删掉不再需要的 `useTranslation`。

### 验证结果（重建产物，同一指标）

| URL | 修复前 cjk 占比 | 修复后 cjk 占比 |
|---|---|---|
| `/zh/whitepaper/` | 0.02 | **0.85** |
| `/zh/features/` | 0.03 | **0.51** |
| `/zh/product/` | 0.05 | 0.38 |
| `/zh/start/` | 0.06 | 0.42 |
| `/zh/product/ui-sdk/` | 0.08 | 0.53 |
| `/zh/product/agent-sdk/` | 0.07 | 0.40 |
| `/zh/community/faq/` | 0.12 | 0.58 |
| `/zh/community/roadmap/` | 0.12 | 0.50 |
| `/zh/resources/hosting/` | 0.13 | 0.54 |
| `/zh/community/showcase/` | 0.17 | 0.24（案例内容来自外部站点 WebCap 抓取，英文属预期） |

### 建议补一条回归测试

现有 `seo-ready.test.mjs` 有 13 个断言，但没有一条能发现「中文页渲染成英文」。建议增加：对 `/zh/**` 代表性页面断言正文中文占比 > 0.35。否则这类 bug 会再次静默发生。

---

## 三、上一轮修复在线上仍未生效

仓库状态：

```
## main...origin/main [ahead 18]
```

包含上一轮全部修复的提交 `321434849 feat(homepage): 补结构化数据与面包屑，并按 URL 解析文档语言` 就在这 18 个未推送提交里。

| 上一轮声称已完成 | 代码库 | 线上实测（2026-09-18） | 判定 |
|---|---|---|---|
| P0-1 `hrefLang` → `hreflang` | ✅ 已改小写 | 页面输出 `<link rel="alternate" hrefLang="en" ...>`，小写 `hreflang` 计数 **0** | ❌ 未生效 |
| P0-2 zh 首页 title 差异化 | ✅ 已差异化 | `/zh/` title 仍是 `Downcity — Agent Harness + Agent Productization Kits`，与英文完全相同 | ❌ 未生效 |
| P1-2 默认分享图 1200×630 | ✅ 已改 | `og:image = https://downcity.ai/social-icon.png`，`twitter:card=summary` | ❌ 未生效 |
| P1-3 `llms.txt` 上线 | ✅ 已入库 | `https://downcity.ai/llms.txt` → **404** | ❌ 未生效 |
| P1-4 FAQPage JSON-LD | ✅ 已输出 | `/community/faq/` 的 `application/ld+json` 计数 **0** | ❌ 未生效 |
| P1-4 BreadcrumbList | ✅ 478 页覆盖 | `/en/docs/`、`/en/docs/quickstart/` 均无 JSON-LD | ❌ 未生效 |

这类问题全部是**静默失效**：页面照常渲染、监控不报错，但 hreflang 语言关联在线上确实不存在。

**这是当前第一优先事项**：在推送部署之前，本轮之前的所有 SEO 工作量都是零产出。

---

## 四、其余新发现问题（本轮已修或已定方案）

### P0-1：页脚全站链接到 404 —— `/resources/examples`（已修）

`Footer.tsx` 把 `examplesPath` 指向 `/resources/examples`，全站每个营销页的页脚都渲染这条链接；但 `routes.ts` 的 `resources` 子路由没有注册 `examples`（`resources.examples.tsx` 文件是存在的），线上实测 404。

另外该文件的 `meta()` 只返回裸 `title/description`，**没有 canonical 与 hreflang**。

**已修**：注册中英路由 + meta 改走 `create_page_meta({ localized: true })` + 补预渲染与 sitemap。

### P0-2：产品总览页卡片链接到 404 —— `/product/cli`（已修）

`/product/index.tsx` 用 `` to={`${base_path}/${card.id}`} `` 拼卡片链接，卡片 id 为 `cli / sdk / agent-sdk / ui-sdk`。其中：

- `/product/cli` 与 `/zh/product/cli` 线上 **404**（仓库里根本没有这个路由文件）
- `/product/sdk` 指向的是 Federation 页面（见 P0-3）

**已修**：卡片改为显式 `href`，CLI 卡片指向真实存在的 `/en/docs/cli/overview/`、`/zh/docs/cli/overview/`。

### P0-3：文档中心页 6 条死链（已修）

`content/docs/{en,zh}/index.mdx` 的「Start Here / 从这里开始」手写了 `/en/docs/agent`、`/plugin`、`/city`、`/federation`、`/security`、`/cli`，但 `content/docs/{en,zh}/<section>/` 下**没有 `index.mdx`**（只有 `overview.mdx` 等），这些目录 URL 全部 404。

注意：文档页内部侧边栏把 section 渲染成折叠组（不含 `<a href>`），所以死链只出现在文档中心页——恰是文档层级里最重要的一页。

**已修**：指向真实 section 入口页（`/en/docs/agent/overview/` 等）并统一补尾斜杠（顺带消除 308）。

### P1-1：首页 H1 只有品牌词（已修，方案 A）

线上 `/` 与 `/zh/` 的 H1 都是同一个词 `Downcity`；品类词全在下面的 `<p>` 里。而 `en/hero.json` 里早已写好却没被首页使用的 `title = "Agent Harness + Agent Productization Kits"`。

**已修**（按你的选择，方案 A）：

| | 修复前 | 修复后 |
|---|---|---|
| `/` H1 | `Downcity` | `Agent Harness + Agent Productization Kits` |
| `/zh/` H1 | `Downcity` | `Agent Harness 与 Agent 产品化 Kit` |

品牌名保留在 title、navbar、footer。视觉版式未改（只是巨型衬线字的文案换了）。

### P1-2：`/features/` 完全没有 H1（已修）

实测修复前 `h1=0, h2=3, h3=10`：页面标题写在 `FeaturesSection.tsx` 的 `<h2>` 上。该组件只被 `routes/features.tsx` 引用（首页用的是另一个 `HomeFeaturesSection`），所以整页没有 H1。

**已修**：`<h2>` → `<h1>`，样式类不变（纯语义修正，零视觉变化）。

### P1-3：4 个产品页共用完全相同的 title 与 description（已修）

修复前 `/product/`、`/product/sdk/`、`/product/agent-sdk/`、`/product/ui-sdk/` 的 title 全是 `Downcity — Product`，description 也是同一段（中文侧同理）。根因：四个子路由都没有导出 `meta`，全部继承父路由。

这四个是产品线最重要的落地页，等于主动放弃差异化排名能力。

**已修**：四个子路由各写独立 meta，标题关键词先行：

```
/product/                Agent Infrastructure Product Matrix — Downcity
/product/city-sdk/       City SDK: Local Agent Host and Service Boundary — Downcity
/product/federation-sdk/ Federation SDK: Reusable Agent Product Backend — Downcity
/product/agent-sdk/      Agent SDK: Embed Local and Remote Agents — Downcity
/product/ui-sdk/         UI SDK: Reusable Components for Agent Workspaces — Downcity
```

### P1-4：`/product/sdk/` 内容叫 Federation SDK、导航叫 City SDK（已按「两个都要」拆分）

页面自身写的是 `Product · Federation SDK`（事实区：`@downcity/federation`、`packages/federation/`、`fed / downfed`），但 navbar 与页脚都把它标成「City SDK」，而 City SDK 的文档在 `/en/city-sdk-docs/`。仓库里 `packages/city` 与 `packages/federation` 也确实是两个包。

**已修**（按你的选择）：

| 页面 | 包名 | 文档入口 |
|---|---|---|
| `/product/city-sdk/`（新增） | `@downcity/city` | `/en/city-sdk-docs/` |
| `/product/federation-sdk/`（新增） | `@downcity/federation` | `/en/docs/federation/overview/` |

- 两个页面各自独立 H1、title、description、canonical、hreflang，且正文语言已修复。
- City SDK 文案严格依据 `content/docs/en/city/overview.mdx`（City owns Agent collection / HTTP+RPC forwarding / host lifecycle；模型目录、身份、用量、计费属于 Federation 与 Embassy），未杜撰事实。
- navbar 与页脚的「City SDK」改指向 `/product/city-sdk/`，并新增「Federation SDK」入口。
- 旧 URL 由 `public/_redirects` 301 到 `/product/federation-sdk/`。
- `app/routes/product/sdk.tsx` 已改为带 `@deprecated` 说明的转发 shim（未注册、不参与构建），确认无引用后可直接删除。

**遗留一个需要你定的设计项**：产品总览页的卡片是 2×2 网格（`sm:grid-cols-2`）。加第 5 张卡片会留出空洞，所以我保留了 4 张卡片（CLI / City SDK / Agent SDK / UI SDK），Federation SDK 通过 navbar、页脚、以及总览页事实区（已加入 `Federation SDK … packages/federation/` 一条）暴露。若要在总览页也给它一张卡片，需要先把网格改成 6 宫格并补第 6 个条目。

### P1-5：`/resources/` 是客户端空跳页面却进了 sitemap（已修）

`resources._index.tsx` 全文只有 `<Navigate to="skills" replace />`，实测 `/resources/` 返回 200 但 `h1=h2=h3=0`、正文约 63 词。被写进 sitemap 并预渲染成一个近乎空白、可被索引的 HTML——典型的「sitemap 里塞软 404」。

**已修**：从 sitemap 移除（附注释说明），保留路由不动，站内点击行为不变。

**后续建议**：更彻底的做法是把它做成真正的资源总览页（复用 `resources.tsx` 布局 + 四张入口卡片），属内容建设，建议与关键词矩阵一起排期。

### P1-6：站内链接普遍无尾斜杠，每次点击多一次 308（未修，已定方案）

canonical 形态是带尾斜杠，但 navbar/Footer/首页的 `Link to=` 大量写成无尾斜杠形式。从首页与文档页抓到的 84 条站内链接里 20 条命中 308：

```
/features  /product  /product/sdk  /start  /terms  /privacy
/resources/skills  /en/docs  /en/payments  /community/faq  ...
```

不影响收录（308 传权重），但每次站内点击多一次往返、额外消耗抓取预算。

**方案**：把 navbar / Footer / 首页里的路径常量统一改成尾斜杠形态。**本轮未改**——两个文件各有约 20 个常量，且与已完成的命名拆分耦合，建议单独一个提交一次改完，便于回归。

### P1-7：文档页有 2 个 H1（未修，低风险）

实测 `/en/docs/`、`/en/docs/quickstart/` 均 `h1=2`，且两个 H1 文本相同。原因：MDX 正文手写了 `# Downcity Docs`，fumadocs 的 `DocsTitle` 又输出一次页面标题。

**方案**：`content/*/*/index.mdx` 正文不再写 `# <title>`，让 fumadocs 统一出标题（改内容，不动组件）。

### P1-8：旧文档路径 `/docs/*` 既没 301 也没内容（未修，方案已定）

`routes/docs/redirect.tsx` 的 loader 会 `throw redirect(path, { status: 301 })`，但站点是纯静态预渲染，只有预渲染列表里的路径存在：

```
https://downcity.ai/docs/quickstart   → 404
https://downcity.ai/docs/             → 200，但内容是
    <title>Redirecting to: /en/docs.data</title>
    <meta name="robots" content="noindex">
    <meta http-equiv="refresh" content="0;url=/en/docs.data">
```

即被预渲染成 React Router 的「数据请求兜底页」，跳转目标还带上了 `.data` 后缀（data router 的内部 URL，不是可访问页面），对用户是死胡同。有 `noindex` 所以不会污染索引。

**方案**：本轮新建的 `public/_redirects` 已经验证可用，再加 6 行即可：

```
/docs/*           /en/docs/:splat           301
/city-sdk-docs/*  /en/city-sdk-docs/:splat  301
/agent-sdk-docs/* /en/agent-sdk-docs/:splat 301
/payments/*       /en/payments/:splat       301
/plugins-docs/*   /en/plugins-docs/:splat   301
/ui-sdk-docs/*    /en/ui-sdk-docs/:splat    301
```

未直接加的原因：这会影响所有旧链接走向，属部署期全局行为，想让你先确认后再动。

---

## 五、P2 级问题（延续上轮，均未处理）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| P2-1 | `www.downcity.ai` 返回 200 与 apex 重复 | 实测 www 返回 200、99,479 字节，canonical 指向 apex | Cloudflare 加 www → apex 的 301 |
| P2-2 | sitemap 无 `<lastmod>` | 545 条 URL 全部无 | 文档站按 MDX 更新时间输出（勿造假值） |
| P2-3 | 无 GSC / Bing / 百度验证与分析脚本 | 仓库无验证 meta、无分析代码 | 上轮就是 P2-3，三个轮次未做，见行动项 |
| P2-4 | 首页 JS/CSS 体积偏大 | 30+ `modulepreload` 小 chunk；主 CSS 228 KB；TTFB ≈ 0.78s（`cf-cache-status: DYNAMIC`） | 后续做 chunk 合并与 HTML 边缘缓存 |
| P2-5 | 薄内容页 | `/community/` 93 词、`/resources/skills/` 98 词、`/community/showcase/` 112 词、`/resources/hosting/` 138 词、`/community/roadmap/` 144 词 | 随内容排期补写，不要 noindex |
| P2-6 | `resources.use-cases.tsx` 是死文件 | 未注册、全站无链接 | 按 examples 方式接上，或删除 |

---

## 六、关键词目标与优先级

### 6.1 首页与产品页核心词

| 关键词 | 搜索意图 | 承接页 | 当前状态 | 优先级 |
|---|---|---|---|---|
| agent harness | 信息型（了解品类） | `/`、`/zh/` | ✅ H1 已命中 | 保持 |
| agent productization | 信息型 | `/`、`/zh/` | ✅ H1 已命中 | 保持 |
| city sdk | 选型 | `/product/city-sdk/` | ✅ 新建且正文/文档口径一致 | 高 |
| federation sdk | 选型 | `/product/federation-sdk/` | ✅ 新建 | 高 |
| agent sdk | 选型 + 采购 | `/product/agent-sdk/` | ✅ meta 已差异化 | 高 |
| agent workspace ui / agent ui kit | 选型 | `/product/ui-sdk/` | ✅ meta 已差异化 | 中 |
| open source agent runtime | 信息型 + 选型 | `/`、`/features/` | 文案有，语义标签可再强化 | 中 |
| downcity（品牌词） | 导航型 | `/` | 正常 | — |

### 6.2 内容缺口（仍是结构性空白）

目前站点几乎只有「产品页 + 文档」，**没有一篇信息型内容**。开发者工具类自然流量的大头在信息型查询。

| 缺口 | 建议页型 | 意图 | 优先级 |
|---|---|---|---|
| what is an agent harness | 术语页 / glossary | 信息型，量最大、竞争最轻 | 高 |
| agent harness vs agent framework | 对比页 | 信息型，决策上游 | 高 |
| Downcity vs 自建 agent 运行时 | 对比页 | 采购型，转化最高 | 高 |
| how to build an agent product | 教程长文 | 信息型 → 产品页 | 中 |
| agent memory / permission / billing 实现指南 | 技术深文 | 承接文档长尾 | 中 |

---

## 七、执行节奏建议

**第 0 步（最高优先，半天）**：`git push origin main` 并重新部署，然后按第三节表格逐项复验线上。在此之前本轮之后的所有优化同样看不到效果。

**第 1 周**：P1-6 内链尾斜杠一次性整改；P1-7 文档重复 H1；决定 P1-8 的 `_redirects` 是否放开。

**第 2 周**：P2-3 接入 GSC / Bing / 百度站长并提交 sitemap；P2-1 www 301；给 `seo-ready.test.mjs` 补「中文页不得预渲染成英文」断言。

**第 3–4 周**：P2-2 `lastmod`；文档 title 模板优化（`{主题} · {栏目} — Downcity Docs`）；P2-5 薄内容页补写；产品总览页 6 宫格改版（含 Federation SDK 卡片）。

**第 2 个月起**：按第 6.2 节产出信息型内容 + 外链分发，用 GSC 数据滚动修正。

---

## 八、最关键的 3 个行动项

1. **推送并重新部署（`git push origin main`，领先 18 个提交）**。线上 hreflang 仍失效、`llms.txt` 仍 404、FAQPage 与 BreadcrumbList 仍未输出——上一轮全部工作量目前等于零，且这类问题不看报告发现不了。（我没有推送权限，未执行。）
2. **决定 P1-8 的 `_redirects` 是否放开**。`public/_redirects` 已随本轮的 SDK 拆分落地并验证可用，再加 6 行就能把 6 个文档空间的旧路径从 404 变成 301，这是 `/docs/*` 类死链的唯一解。
3. **接入 Google Search Console 并提交 sitemap**。三个 SEO 轮次过去了这一项始终未做，没有它就没有任何查询词/点击/排名数据，后续优化无法判断对错。

---

## 九、本轮修复记录（2026-09-18）

> 验证方式：完整重建（`npx react-router build`，**553 个 HTML 全部预渲染，exit 0**）
> + `node --test scripts/seo-ready.test.mjs`（**13/13 通过**）
> + `npx react-router typegen && npx tsc --noEmit`（**exit 0**）
> + 逐项抽查构建产物 HTML 与 sitemap。

### 9.1 中文站预渲染修复（P0-0，15 个文件）

改为 URL 派生语言：翻译型组件用 `i18n.getFixedT(use_interface_locale())`；本地 COPY 型组件直接用 `use_interface_locale()`。

`CTASection` `CodePreviewSection` `WhitepaperSection` `StartGuideSection` `CommunitySection` `FeaturesSection` `product/index` `product/city-sdk`(新) `product/federation-sdk`(新) `product/agent-sdk` `product/ui-sdk` `community.roadmap` `community.showcase` `resources.skills` `resources.hosting` `resources.examples`

产物复验：`/zh/whitepaper/` 中文占比 0.02 → **0.85**；`/zh/features/` 0.03 → 0.51；`/zh/start/` 0.06 → 0.42（完整对照见第二节）。

### 9.2 404 类修复

| 问题 | 文件 | 修改 | 产物验证 |
|---|---|---|---|
| 页脚全站 404 | `routes.ts`、`resources.examples.tsx`、`react-router.config.ts`、`sitemap.xml.ts` | 注册 examples 中英路由；meta 改 `create_page_meta({localized:true})`；补预渲染与 sitemap | `resources/examples/index.html`、`zh/…` 生成，h1=1、hreflang=3、canonical=self |
| `/product/cli` 404 | `product/index.tsx` | 卡片改显式 `href`，CLI 指向 `/en/docs/cli/overview/` | 产物中 `/product/cli` 计数 **0**，新链存在 |
| 文档中心页 6 条死链 | `content/docs/{en,zh}/index.mdx` | 指向真实 section 入口页 + 补尾斜杠 | 旧 URL 计数 0，新 URL 各命中 1 |

### 9.3 on-page 修复

| 问题 | 文件 | 修改 | 产物验证 |
|---|---|---|---|
| 首页 H1 无品类词 | `locales/{en,zh}/home.json` | H1 改为方案 A | `/` H1=`Agent Harness + Agent Productization Kits`；`/zh/` H1=`Agent Harness 与 Agent 产品化 Kit` |
| `/features/` 无 H1 | `FeaturesSection.tsx` | 页面标题 `<h2>` → `<h1>` | `features/index.html`、`zh/features/index.html` h1=1 |
| 4 个产品页重复 meta | `product/{index,city-sdk,federation-sdk,agent-sdk,ui-sdk}.tsx` | 各写独立 `meta()`，关键词先行 | 五页 title 互不相同，h1=1、hreflang=3、canonical=self |
| `/resources/` 空壳页入 sitemap | `sitemap.xml.ts` | 从 sitemap 移除（附注释） | sitemap 无 `https://downcity.ai/resources/` |

### 9.4 SDK 命名拆分（P1-4）

| 动作 | 文件 |
|---|---|
| 新增 City SDK 页 | `app/routes/product/city-sdk.tsx` |
| 新增 Federation SDK 页 | `app/routes/product/federation-sdk.tsx` |
| 旧页转 shim（未注册） | `app/routes/product/sdk.tsx` → `@deprecated` 转发说明 |
| 注册中英路由 | `app/routes.ts` |
| 预渲染 + sitemap | `react-router.config.ts`、`sitemap.xml.ts`（新增 2 个 URL、移除 1 个） |
| 导航与页脚 | `navbar.tsx`、`Footer.tsx`（City SDK 改指向新页 + 新增 Federation SDK 入口） |
| 旧 URL 301 | `public/_redirects`（新建） |

产物验证：四个新页面（中英）h1=1、hreflang=3、canonical=self；sitemap 含 `city-sdk` / `federation-sdk`、不含 `/product/sdk/`；`build/client/_redirects` 已生成。

### 9.5 量化变化

- sitemap URL 数：543（第一轮后）→ **545**（移除 `/resources/` 与 `/product/sdk/` 三条空壳/旧路径，新增 `/resources/examples/`、`/product/city-sdk/`、`/product/federation-sdk/`）
- 预渲染 HTML：551 → **553**
- 全站 `hrefLang` 驼峰残留：**0 条**

## 十、后续落地（2026-09-18，获批项执行完毕）

> 同样通过完整重建（553 个 HTML，exit 0）+ `test:seo` 13/13 + `tsc --noEmit` exit 0 验证。
> 关键词判断与数据来源见 [`downcity-keyword-matrix-2026-09-18.md`](./downcity-keyword-matrix-2026-09-18.md)。

| # | 事项 | 修改 | 产物验证 |
|---|---|---|---|
| 1 | 旧文档路径 301（原 P1-8） | `public/_redirects` 补齐 6 个文档空间的裸路径与通配规则（共 12 条） | 产物 `_redirects` 含 16 条规则；`/docs/*` 类路径不再落到 404 或 `.data` 兜底页 |
| 2 | 产品总览页 6 宫格（原待定设计项） | `product/index.tsx` 网格改 `lg:grid-cols-3`；新增 Federation SDK 卡片与第 6 张 Services & Payment 卡片（`packages/implementations/services/`，包名 `@downcity/services` 已核对）；中英副标题同步 | 两页各渲染 **6 张卡片**，链接分别为 CLI 文档 / city-sdk / federation-sdk / agent-sdk / ui-sdk / payments |
| 3 | 删除 `product/sdk.tsx` shim | 已确认无任何代码引用后删除 | `ls` 确认不存在，`tsc` 通过 |
| 4 | 关键词优化：7 个薄 title 页 × 中英 | `features` `start` `whitepaper` `community.faq` `resources.skills` `resources.hosting` `community.roadmap` 改为关键词先行、品牌收尾；顺带清理 6 个文件的未使用 `product` 导入 | 14 个页面 title 长度 35–57 字符、互不重复，均 `h1=1`、`hreflang=3` |

至此，原报告第三节的 3 个行动项中，第 2 项（`_redirects`）已完成；第 1 项（推送部署）与第 3 项（接入 GSC）仍待你侧执行。

---

## 十一、首篇信息型内容上线（2026-09-18）

站点此前**只有产品页 + 文档，没有一篇信息型内容**，而联想词证据显示需求大头正在信息型。现已新增 `blog` 内容空间并发布第一篇（中英双语）：

- `/en/blog/what-is-an-agent-harness/`（约 1380 词）
- `/zh/blog/what-is-an-agent-harness/`（约 1900 汉字，独立重写、非直译）

工程上新增：`blog` fumadocs 集合、`app/lib/blog-source.ts`、`app/routes/blog/page.tsx`、`SeoArticleStructuredData`、`create_article_structured_data`、路由／预渲染／sitemap／`_redirects`／`llms.txt` 接线。

关键设计：文章页 **不挂 DocsLayout 侧边栏**（root.tsx 的 `showGlobalChrome` 因此为真，navbar 与 Footer 正常显示），H1 由路由从 frontmatter 输出，MDX 正文禁止再写 `# 标题`（避开文档区现存的重复 h1 问题）。

验证：重建 **555 个 HTML**（+2）、`test:seo` **13/13**、`tsc --noEmit` **exit 0**；两页 `h1=1`、`hreflang=3`、canonical self、`BlogPosting` JSON-LD（`inLanguage` 分别为 `en` / `zh-CN`）；sitemap **547 条**；文章内链 **67 条全部可解析，无 404**。

关键词选定依据与下一篇建议见 [`downcity-keyword-matrix-2026-09-18.md`](./downcity-keyword-matrix-2026-09-18.md) 第八节。

### 环境备注

本 sandbox 的 `node_modules` 缺失 linux-arm64 原生绑定（`@rolldown/binding-linux-arm64-gnu`、`@rollup/rollup-linux-arm64-gnu`、`lightningcss-linux-arm64-gnu`、`@tailwindcss/oxide-linux-arm64-gnu`），已从 npm registry 手动恢复二进制后完成全部构建与校验。**仅影响 sandbox 的依赖目录，未改动任何仓库文件**；本机正常 `pnpm install` 无此问题。

第一次重建曾因 `prerender` 仍保留已拆除的 `/product/sdk` 而失败（`Unable to prerender path because it does not match any routes`），已修正为仅由 `_redirects` 接管。

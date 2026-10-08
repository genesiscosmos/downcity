import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  // Homepage
  index("routes/home.tsx"),
  route("zh", "routes/home.tsx", { id: "home-zh" }),
  route("whitepaper", "routes/whitepaper.tsx"),
  route("zh/whitepaper", "routes/whitepaper.tsx", { id: "whitepaper-zh" }),
  route("start", "routes/start.tsx"),
  route("zh/start", "routes/start.tsx", { id: "start-zh" }),
  route("terms", "routes/terms.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("sitemap.xml", "routes/sitemap.xml.ts"),
  route("llms-full.txt", "routes/llms-full.txt.ts"),
  route("feed.xml", "routes/feed.xml.ts"),

  // Blog（信息型营销内容，不用文档侧边栏版式）
  // 列表页必须排在 splat 之前，否则 /en/blog 会被 en/blog/* 吃掉。
  route("en/blog", "routes/blog/index.tsx", { id: "blog-index-en" }),
  route("zh/blog", "routes/blog/index.tsx", { id: "blog-index-zh" }),
  route("en/blog/*", "routes/blog/page.tsx", { id: "blog-en" }),
  route("zh/blog/*", "routes/blog/page.tsx", { id: "blog-zh" }),

  // Features page
  route("features", "routes/features.tsx"),
  route("zh/features", "routes/features.tsx", { id: "features-zh" }),

  // Product with child routes
  route("product", "routes/product.tsx", [
    index("routes/product/index.tsx"),
    route("city-sdk", "routes/product/city-sdk.tsx"),
    route("federation-sdk", "routes/product/federation-sdk.tsx"),
    route("agent-sdk", "routes/product/agent-sdk.tsx"),
    route("ui-sdk", "routes/product/ui-sdk.tsx"),
  ]),
  route(
    "zh/product",
    "routes/product.tsx",
    { id: "routes/zh/product" },
    [
      index("routes/product/index.tsx", { id: "routes/zh/product._index" }),
      route("city-sdk", "routes/product/city-sdk.tsx", {
        id: "routes/zh/product.city-sdk",
      }),
      route("federation-sdk", "routes/product/federation-sdk.tsx", {
        id: "routes/zh/product.federation-sdk",
      }),
      route("agent-sdk", "routes/product/agent-sdk.tsx", {
        id: "routes/zh/product.agent-sdk",
      }),
      route("ui-sdk", "routes/product/ui-sdk.tsx", {
        id: "routes/zh/product.ui-sdk",
      }),
    ],
  ),

  // Resources with child routes
  route("resources", "routes/resources.tsx", [
    index("routes/resources._index.tsx"),
    route("skills", "routes/resources.skills.tsx"),
    route("marketplace", "routes/resources.marketplace.tsx"),
    route("hosting", "routes/resources.hosting.tsx"),
    route("examples", "routes/resources.examples.tsx"),
  ]),
  route(
    "zh/resources",
    "routes/resources.tsx",
    { id: "routes/zh/resources" },
    [
      index("routes/resources._index.tsx", { id: "routes/zh/resources._index" }),
      route("skills", "routes/resources.skills.tsx", {
        id: "routes/zh/resources.skills",
      }),
      route("marketplace", "routes/resources.marketplace.tsx", {
        id: "routes/zh/resources.marketplace",
      }),
      route("hosting", "routes/resources.hosting.tsx", {
        id: "routes/zh/resources.hosting",
      }),
      route("examples", "routes/resources.examples.tsx", {
        id: "routes/zh/resources.examples",
      }),
    ],
  ),

  // Community with child routes
  route("community", "routes/community.tsx", [
    index("routes/community._index.tsx"),
    route("faq", "routes/community.faq.tsx"),
    route("roadmap", "routes/community.roadmap.tsx"),
    route("showcase", "routes/community.showcase.tsx"),
  ]),
  route(
    "zh/community",
    "routes/community.tsx",
    { id: "routes/zh/community" },
    [
      index("routes/community._index.tsx", { id: "routes/zh/community._index" }),
      route("faq", "routes/community.faq.tsx", { id: "routes/zh/community.faq" }),
      route("roadmap", "routes/community.roadmap.tsx", {
        id: "routes/zh/community.roadmap",
      }),
      route("showcase", "routes/community.showcase.tsx", {
        id: "routes/zh/community.showcase",
      }),
    ],
  ),

  // 文档路由：六个空间共用同一个页面实现，版式由组件层承担，不再需要 layout 路由。
  route("en/docs/*", "routes/docs/page.tsx", { id: "docs-en" }),
  route("docs/*", "routes/docs/redirect.tsx", { id: "docs-redirect" }),
  route("zh/docs/*", "routes/docs/page.tsx", { id: "docs-zh" }),

  route("en/city-sdk-docs/*", "routes/city-sdk-docs/page.tsx", {
    id: "city-sdk-docs-en",
  }),
  route("city-sdk-docs/*", "routes/city-sdk-docs/redirect.tsx", {
    id: "city-sdk-docs-redirect",
  }),
  route("zh/city-sdk-docs/*", "routes/city-sdk-docs/page.tsx", {
    id: "city-sdk-docs-zh",
  }),

  route("en/agent-sdk-docs/*", "routes/agent-sdk-docs/page.tsx", {
    id: "agent-sdk-docs-en",
  }),
  route("agent-sdk-docs/*", "routes/agent-sdk-docs/redirect.tsx", {
    id: "agent-sdk-docs-redirect",
  }),
  route("zh/agent-sdk-docs/*", "routes/agent-sdk-docs/page.tsx", {
    id: "agent-sdk-docs-zh",
  }),

  route("en/payments/*", "routes/payments/page.tsx", { id: "payments-en" }),
  route("payments/*", "routes/payments/redirect.tsx", { id: "payments-redirect" }),
  route("zh/payments/*", "routes/payments/page.tsx", { id: "payments-zh" }),

  route("en/powers-docs/*", "routes/powers-docs/page.tsx", {
    id: "powers-docs-en",
  }),
  route("powers-docs/*", "routes/powers-docs/redirect.tsx", {
    id: "powers-docs-redirect",
  }),
  route("zh/powers-docs/*", "routes/powers-docs/page.tsx", {
    id: "powers-docs-zh",
  }),

  route("en/ui-sdk-docs/*", "routes/ui-sdk-docs/page.tsx", { id: "ui-sdk-docs-en" }),
  route("ui-sdk-docs/*", "routes/ui-sdk-docs/redirect.tsx", {
    id: "ui-sdk-docs-redirect",
  }),
  route("zh/ui-sdk-docs/*", "routes/ui-sdk-docs/page.tsx", { id: "ui-sdk-docs-zh" }),

  // 静态检索索引：按语言各生成一份，由文档搜索在浏览器内检索，不再需要服务端搜索接口。
  route("search-index.en.json", "routes/search-index.ts", { id: "search-index-en" }),
  route("search-index.zh.json", "routes/search-index.ts", { id: "search-index-zh" }),

  route("api/webcap", "routes/api.webcap.ts"),
] satisfies RouteConfig;

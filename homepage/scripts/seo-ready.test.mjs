/**
 * Homepage SEO 构建产物回归测试。
 *
 * 该测试在完整 build 后执行，验证 sitemap、canonical、hreflang 与静态 404
 * 确实进入 Cloudflare Pages 发布目录，而不只是在源码层看起来正确。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const build_root = new URL("../build/client/", import.meta.url);

/** 读取构建目录中的 UTF-8 文本文件。 */
async function read_build_file(relative_path) {
  return readFile(new URL(relative_path, build_root), "utf8");
}

/** 转义正则元字符，用于从固定 URL 构造精确匹配。 */
function escape_regexp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 从首页构建产物中读取 Downcity 实体 JSON-LD。 */
function read_home_structured_data(html) {
  const match = html.match(
    /<script type="application\/ld\+json" data-downcity-structured-data="home">([^<]+)<\/script>/,
  );

  assert.ok(match, "首页必须输出 Downcity 实体 JSON-LD");
  return JSON.parse(match[1]);
}

/** 从 FAQ 页构建产物中读取 FAQPage JSON-LD。 */
function read_faq_structured_data(html) {
  const match = html.match(
    /<script type="application\/ld\+json" data-downcity-structured-data="faq">([\s\S]+?)<\/script>/,
  );

  assert.ok(match, "FAQ 页必须输出 FAQPage JSON-LD");
  return JSON.parse(match[1]);
}

/** 从文档页构建产物中读取 BreadcrumbList JSON-LD。 */
function read_breadcrumb_structured_data(html) {
  const match = html.match(
    /<script type="application\/ld\+json" data-downcity-structured-data="breadcrumb">([\s\S]+?)<\/script>/,
  );

  assert.ok(match, "文档页必须输出 BreadcrumbList JSON-LD");
  return JSON.parse(match[1]);
}

/** 从预渲染 HTML 中读取语言偏好引导脚本。 */
function read_locale_bootstrap_script(html) {
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
  const match = scripts.find((entry) => entry[1]?.includes("downcity-locale"));

  assert.ok(match?.[1], "首页必须在 React 渲染前输出语言偏好引导脚本");
  return match[1];
}

/** 在隔离上下文中执行构建产物的语言引导脚本。 */
function run_locale_bootstrap(script, cookie, pathname) {
  let redirect_target = null;
  const location = {
    pathname,
    search: "?source=test",
    hash: "#locale",
    replace(target) {
      redirect_target = target;
    },
  };

  runInNewContext(script, {
    document: { cookie },
    window: { location },
  });

  return redirect_target;
}

test("sitemap 输出规范 XML 和公开 URL", async () => {
  const sitemap = await read_build_file("sitemap.xml");

  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset[^>]+xmlns:xhtml=/);
  assert.match(sitemap, /<loc>https:\/\/downcity\.ai\/</);
  assert.match(sitemap, /hreflang="zh-CN"/);
  assert.doesNotMatch(sitemap, /www\.downcity\.ai/);
  assert.doesNotMatch(sitemap, /\.mdx(?:<|&)/);
  assert.doesNotMatch(sitemap, /<html/i);
});

test("营销页与文档页输出 self canonical 和双向 hreflang", async () => {
  const cases = [
    ["index.html", "https://downcity.ai/", "https://downcity.ai/zh/"],
    ["zh/features/index.html", "https://downcity.ai/zh/features/", "https://downcity.ai/features/"],
    [
      "en/docs/agent/overview/index.html",
      "https://downcity.ai/en/docs/agent/overview/",
      "https://downcity.ai/zh/docs/agent/overview/",
    ],
  ];

  for (const [relative_path, canonical_url, alternate_url] of cases) {
    const html = await read_build_file(relative_path);
    assert.match(html, new RegExp(`<link rel="canonical" href="${escape_regexp(canonical_url)}"`));
    // hreflang 必须以小写属性名出现在构建产物中：React meta 描述符写驼峰
    // hrefLang 会被原样序列化成非法属性名，而宽松的 href 存在性断言无法发现
    // 该问题（2026-09 回归：全站页面级 hreflang 因此失效）。
    assert.match(
      html,
      new RegExp(`<link rel="alternate" hreflang="[^"}]+" href="${escape_regexp(alternate_url)}"`),
      `${relative_path} 缺少小写 hreflang 语言注解`,
    );
    assert.match(html, /<meta name="robots" content="index, follow"/);
  }

  const hreflang_pages = [
    "index.html",
    "zh/index.html",
    "features/index.html",
    "zh/features/index.html",
    "start/index.html",
    "zh/start/index.html",
    "whitepaper/index.html",
    "product/index.html",
  ];

  for (const relative_path of hreflang_pages) {
    const html = await read_build_file(relative_path);
    assert.doesNotMatch(
      html,
      /<link[^>]*hrefLang=/,
      `${relative_path} 输出了驼峰 hrefLang 非法属性`,
    );
    assert.match(html, /<link rel="alternate" hreflang="x-default"/);
  }
});

test("中英文首页 title 差异化输出", async () => {
  const english_html = await read_build_file("index.html");
  const chinese_html = await read_build_file("zh/index.html");
  const english_title = english_html.match(/<title>([^<]+)<\/title>/)?.[1];
  const chinese_title = chinese_html.match(/<title>([^<]+)<\/title>/)?.[1];

  assert.ok(english_title, "英文首页必须输出 title");
  assert.ok(chinese_title, "中文首页必须输出 title");
  assert.notEqual(english_title, chinese_title, "中英文首页 title 不得完全相同");
  assert.match(chinese_title, /[\u4e00-\u9fff]/, "zh 首页 title 必须包含中文品类词");
});

test("默认社交分享图使用 1200x630 横图并启用大图卡片", async () => {
  const pages = ["index.html", "zh/index.html", "start/index.html", "whitepaper/index.html"];

  for (const relative_path of pages) {
    const html = await read_build_file(relative_path);
    assert.match(
      html,
      /<meta property="og:image" content="https:\/\/downcity\.ai\/og-image\.png"/,
      `${relative_path} 的 og:image 应使用 1200x630 横图 og-image.png`,
    );
    assert.doesNotMatch(
      html,
      /<meta property="og:image" content="[^"]*social-icon\.png"/,
      `${relative_path} 不应再用 512x512 方形图作为分享图`,
    );
    assert.match(
      html,
      /<meta name="twitter:card" content="summary_large_image"/,
      `${relative_path} 应启用大图分享卡片`,
    );
  }
});

test("中英文首页输出相互关联的品牌实体", async () => {
  const english_html = await read_build_file("index.html");
  const chinese_html = await read_build_file("zh/index.html");
  const english_data = read_home_structured_data(english_html);
  const chinese_data = read_home_structured_data(chinese_html);

  assert.equal(english_data["@context"], "https://schema.org");
  assert.deepEqual(
    english_data["@graph"].map((entry) => entry["@type"]),
    ["Organization", "WebSite", "SoftwareApplication"],
  );

  const organization = english_data["@graph"][0];
  const website = english_data["@graph"][1];
  const software = english_data["@graph"][2];

  assert.equal(organization["@id"], "https://genesiscosmos.com/#organization");
  assert.equal(website.publisher["@id"], organization["@id"]);
  assert.equal(website.about["@id"], software["@id"]);
  assert.equal(software.publisher["@id"], organization["@id"]);
  assert.equal(software.codeRepository, "https://github.com/genesiscosmos/downcity");
  assert.equal(software.applicationSubCategory, "Agent Harness and Productization Kits");
  assert.ok(software.sameAs.includes("https://x.com/downcity_ai"));
  assert.match(software.description, /Agent Harness and Agent Productization Kits/);
  assert.match(chinese_data["@graph"][2].description, /Agent Harness 与 Agent Productization Kits/);
});

test("中英文首页预渲染各自的核心定位文案", async () => {
  const english_html = await read_build_file("index.html");
  const chinese_html = await read_build_file("zh/index.html");

  assert.match(english_html, /Build worlds where agents live, work, and collaborate\./);
  assert.match(english_html, /From agent runtime/);
  assert.match(english_html, /to product\./);
  assert.doesNotMatch(english_html, /创造 Agent 居住、工作与协作的世界。/);

  assert.match(chinese_html, /创造 Agent 居住、工作与协作的世界。/);
  assert.match(chinese_html, /从 Agent 运行时/);
  assert.match(chinese_html, /到产品化交付。/);
  assert.doesNotMatch(chinese_html, /Build worlds where agents live, work, and collaborate\./);
});

test("首页构建产物包含语言偏好引导且不再依赖旧本地状态", async () => {
  const english_html = await read_build_file("index.html");
  const chinese_html = await read_build_file("zh/index.html");

  for (const html of [english_html, chinese_html]) {
    assert.match(html, /downcity-locale/);
    assert.match(html, /window\.location\.replace/);
    assert.doesNotMatch(html, /downcity-lang/);
  }
});

test("语言偏好只引导无前缀营销入口且保留查询参数与哈希", async () => {
  const english_html = await read_build_file("index.html");
  const script = read_locale_bootstrap_script(english_html);

  assert.equal(
    run_locale_bootstrap(script, "downcity-locale=zh", "/"),
    "/zh?source=test#locale",
  );
  assert.equal(
    run_locale_bootstrap(script, "downcity-locale=zh", "/features"),
    "/zh/features?source=test#locale",
  );
  assert.equal(run_locale_bootstrap(script, "downcity-locale=en", "/"), null);
  assert.equal(run_locale_bootstrap(script, "downcity-locale=zh", "/en/docs"), null);
  assert.equal(run_locale_bootstrap(script, "downcity-locale=zh", "/zh"), null);
});

test("中英文首页稳定输出核心产品入口", async () => {
  const cases = [
    [
      "index.html",
      [
        "/product",
        "/start",
        "/en/agent-sdk-docs",
        "/en/city-sdk-docs",
        "/en/docs",
      ],
    ],
    [
      "zh/index.html",
      [
        "/zh/product",
        "/zh/start",
        "/zh/agent-sdk-docs",
        "/zh/city-sdk-docs",
        "/zh/docs",
      ],
    ],
  ];

  for (const [relative_path, core_paths] of cases) {
    const html = await read_build_file(relative_path);
    for (const core_path of core_paths) {
      assert.ok(html.includes(`href="${core_path}"`), `${relative_path} 缺少核心入口 ${core_path}`);
    }
    assert.ok(html.includes('href="https://github.com/genesiscosmos/downcity"'));
  }
});

test("静态 404 页面禁止索引", async () => {
  const html = await read_build_file("404.html");

  assert.match(html, /<title>Page not found - Downcity<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
});

test("FAQ 页预渲染完整问答文本并输出同源 FAQPage JSON-LD", async () => {
  const english_html = await read_build_file("community/faq/index.html");
  const chinese_html = await read_build_file("zh/community/faq/index.html");
  const english_data = read_faq_structured_data(english_html);
  const chinese_data = read_faq_structured_data(chinese_html);

  // 问答内容必须进入预渲染 HTML（此前收起态答案完全不输出）。
  assert.match(english_html, /Will the Agent modify my code/);
  assert.match(english_html, /By default, no/);
  assert.doesNotMatch(english_html, /Agent 会修改我的代码吗/);

  // zh 页面 SSR 必须输出中文内容（此前 i18next 单例固定 en，zh 页面预渲染成英文）。
  assert.match(chinese_html, /Agent 会修改我的代码吗/);
  assert.match(chinese_html, /默认不会/);
  assert.doesNotMatch(chinese_html, /Will the Agent modify my code/);

  // JSON-LD 与可见文本同源同语言。
  assert.equal(english_data["@type"], "FAQPage");
  assert.equal(english_data.mainEntity.length, 8);
  assert.equal(english_data.mainEntity[0].name, "Will the Agent modify my code?");
  assert.equal(chinese_data.mainEntity[0].name, "Agent 会修改我的代码吗？");
  assert.ok(chinese_data.mainEntity[0].acceptedAnswer.text.length > 10);
});

test("文档页输出 BreadcrumbList JSON-LD 且层级指向真实 URL", async () => {
  const pages = [
    "en/docs/agent/overview/index.html",
    "zh/docs/agent/overview/index.html",
    "en/city-sdk-docs/quickstart/create-city/index.html",
    "en/payments/payment-dodo/index.html",
  ];

  for (const relative_path of pages) {
    const html = await read_build_file(relative_path);
    const data = read_breadcrumb_structured_data(html);

    assert.equal(data["@type"], "BreadcrumbList");
    assert.ok(data.itemListElement.length >= 2, `${relative_path} 面包屑至少两层`);

    for (const [index, entry] of data.itemListElement.entries()) {
      assert.equal(entry.position, index + 1);
      assert.match(entry.item, /^https:\/\/downcity\.ai\//);
      assert.ok(entry.name.length > 0);
    }

    const last = data.itemListElement.at(-1);
    const canonical = html.match(
      /<link rel="canonical" href="([^"]+)"/,
    )?.[1];
    assert.ok(canonical, `${relative_path} 必须有 canonical 可比对`);
    assert.equal(
      last.item,
      canonical,
      `${relative_path} 面包屑最后一层必须对应当前页面 canonical`,
    );
  }

  // 集合根页输出单层面包屑指向自身，禁止空 itemListElement。
  const root_html = await read_build_file("en/payments/index.html");
  const root_data = read_breadcrumb_structured_data(root_html);
  assert.equal(root_data.itemListElement.length, 1, "集合根页面包屑必须恰好单层");
  assert.equal(root_data.itemListElement[0].name, "Payments");
  const root_canonical = root_html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  assert.ok(root_canonical, "集合根页必须有 canonical 可比对");
  assert.equal(root_data.itemListElement[0].item, root_canonical);
});

test("llms.txt 进入构建产物且包含文档地图", async () => {
  const llms_txt = await read_build_file("llms.txt");

  assert.match(llms_txt, /^# Downcity/);
  assert.match(llms_txt, /https:\/\/downcity\.ai\/en\/docs\//);
  assert.match(llms_txt, /https:\/\/downcity\.ai\/zh\/docs\//);
  assert.match(llms_txt, /https:\/\/github\.com\/genesiscosmos\/downcity/);
});

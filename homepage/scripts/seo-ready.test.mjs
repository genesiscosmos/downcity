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

/** 从首页构建产物中读取 Downcity 实体 JSON-LD。 */
function read_home_structured_data(html) {
  const match = html.match(
    /<script type="application\/ld\+json" data-downcity-structured-data="home">([^<]+)<\/script>/,
  );

  assert.ok(match, "首页必须输出 Downcity 实体 JSON-LD");
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
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical_url}"`));
    assert.ok(html.includes(`href="${alternate_url}"`));
    assert.match(html, /<meta name="robots" content="index, follow"/);
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

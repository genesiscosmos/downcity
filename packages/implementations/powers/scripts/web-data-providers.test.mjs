/** WebPower 内建搜索与文档 Provider 回归测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ExaSearchProvider,
  FetchDocumentProvider,
  FirecrawlDocumentProvider,
  TavilySearchProvider,
} from "../bin/web.js";

/** 在单个测试期间替换全局 fetch。 */
async function with_fetch(mock, run) {
  const original_fetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = original_fetch;
  }
}

test("TavilySearchProvider 发送 Bearer 凭据并归一化结果", async () => {
  await with_fetch(async (_url, init) => {
    assert.equal(init.headers.authorization, "Bearer tavily-secret");
    return new Response(JSON.stringify({
      results: [{ url: "https://example.com/a", title: "A", content: "Summary", score: 0.9 }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    const result = await new TavilySearchProvider({ api_key: "tavily-secret" }).search({ query: "test" });
    assert.equal(result.provider, "tavily");
    assert.equal(result.items[0].snippet, "Summary");
  });
});

test("ExaSearchProvider 发送 x-api-key 并归一化结果", async () => {
  await with_fetch(async (_url, init) => {
    assert.equal(init.headers["x-api-key"], "exa-secret");
    return new Response(JSON.stringify({
      results: [{ url: "https://example.com/b", title: "B", text: "Excerpt", score: 0.8 }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    const result = await new ExaSearchProvider({ api_key: "exa-secret" }).search({ query: "test" });
    assert.equal(result.provider, "exa");
    assert.equal(result.items[0].snippet, "Excerpt");
  });
});

test("FetchDocumentProvider 拒绝私网并把公网 HTML 转为正文", async () => {
  const provider = new FetchDocumentProvider();
  await assert.rejects(() => provider.open({ url: "http://127.0.0.1/private" }), /not public/u);
  await with_fetch(async () => new Response(
    "<html><head><title>Example &amp; Test</title><style>.x{}</style></head><body><h1>Hello</h1><script>secret()</script><p>World</p></body></html>",
    { status: 200, headers: { "content-type": "text/html" } },
  ), async () => {
    const result = await provider.open({ url: "http://93.184.216.34/page" });
    assert.equal(result.title, "Example & Test");
    assert.match(result.content, /Hello\nWorld/u);
    assert.doesNotMatch(result.content, /secret/u);
  });
});

test("FirecrawlDocumentProvider 只返回脱敏后的结构化文档", async () => {
  await with_fetch(async (_url, init) => {
    assert.equal(init.headers.authorization, "Bearer firecrawl-secret");
    return new Response(JSON.stringify({
      success: true,
      data: {
        markdown: "# Document",
        metadata: { title: "Document", sourceURL: "https://example.com/document" },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    const provider = new FirecrawlDocumentProvider({ api_key: "firecrawl-secret" });
    const result = await provider.open({ url: "https://example.com" });
    assert.equal(result.provider, "firecrawl");
    assert.equal(result.content, "# Document");
  });
});

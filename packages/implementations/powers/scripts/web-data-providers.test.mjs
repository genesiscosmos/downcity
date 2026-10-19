/**
 * WebPower 内建搜索与文档 Provider 回归测试。
 *
 * 在真实的统一出站边界拦截请求，默认拒绝所有未声明的网络访问。
 * 覆盖 API 重定向保护、DeepSeek 有限重试与总超时，确保测试始终离线运行。
 */

import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as outbound_http from "@downcity/city/http";

/** 未声明的请求必须在测试进程内失败，禁止落到真实网络。 */
const reject_network = async () => { throw new Error("Unexpected outbound HTTP request in offline test"); };
let current_fetch = reject_network;
mock.module("@downcity/city/http", {
  namedExports: {
    ...outbound_http,
    outbound_http_fetch: (...args) => current_fetch(...args),
  },
});

// 必须先注册模块 mock 再加载 Provider，保证拦截统一出站客户端的真实导入。
const {
  DeepSeekSearchProvider,
  DeepSeekDocumentProvider,
  ExaSearchProvider,
  FetchDocumentProvider,
  FirecrawlDocumentProvider,
  TavilySearchProvider,
} = await import("../bin/web.js");
const { safe_fetch } = await import("../bin/web/providers/WebHttp.js");

/** 只替换当前测试的出站实现，结束后恢复为默认拒绝。 */
async function with_fetch(fetch_mock, run) {
  current_fetch = fetch_mock;
  try {
    await run();
  } finally {
    current_fetch = reject_network;
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

/** 创建成功的 DeepSeek JSON 响应，按需要携带 Retry-After。 */
function deepseek_response(status = 200, retry_after) {
  return new Response(JSON.stringify(status === 200
    ? { results: [], title: "Page", content: "# Page" }
    : { error: { message: "secret-response-must-not-leak" } }), {
    status,
    headers: {
      "content-type": "application/json",
      ...(retry_after === undefined ? {} : { "retry-after": retry_after }),
    },
  });
}

test("官方 API 拒绝同源与跨源重定向，不发送第二次请求且释放响应正文", async () => {
  const providers = [
    [new TavilySearchProvider({ api_key: "secret" }), "search", { query: "test" }],
    [new ExaSearchProvider({ api_key: "secret" }), "search", { query: "test" }],
    [new FirecrawlDocumentProvider({ api_key: "secret" }), "open", { url: "https://example.com" }],
    [new DeepSeekSearchProvider({ api_key: "secret" }), "search", { query: "test" }],
    [new DeepSeekDocumentProvider({ api_key: "secret" }), "open", { url: "https://example.com" }],
  ];
  for (const location of ["/moved", "https://other.example/path"]) {
    for (const [provider, method, input] of providers) {
      let requests = 0;
      let cancelled = false;
      await with_fetch(async (_url, init) => {
        requests += 1;
        assert.equal(init.redirect, "manual");
        return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
          status: 307,
          headers: { location },
        });
      }, async () => {
        await assert.rejects(() => provider[method](input), /API endpoint redirects are not allowed/u);
        assert.equal(requests, 1);
        assert.equal(cancelled, true);
      });
    }
  }
});

test("普通网页允许公网跳转，仍拒绝跳转到私网", async () => {
  const seen_urls = [];
  await with_fetch(async (url) => {
    seen_urls.push(String(url));
    return seen_urls.length === 1
      ? new Response(null, { status: 302, headers: { location: "/next" } })
      : new Response("Final body");
  }, async () => {
    const result = await safe_fetch("http://93.184.216.34/start");
    assert.equal(result.text, "Final body");
    assert.deepEqual(seen_urls, ["http://93.184.216.34/start", "http://93.184.216.34/next"]);
  });
  let requests = 0;
  await with_fetch(async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  }, async () => {
    await assert.rejects(() => safe_fetch("http://93.184.216.34/start"), /not public/u);
    assert.equal(requests, 1);
  });
});

test("DeepSeek Search 与 Fetch 在 408、429、5xx 后按 Retry-After 重试", async () => {
  for (const status of [408, 429, 500, 504, 599]) {
    for (const method of ["search", "open"]) {
      const provider = method === "search"
        ? new DeepSeekSearchProvider({ api_key: "secret" })
        : new DeepSeekDocumentProvider({ api_key: "secret" });
      const input = method === "search" ? { query: "test" } : { url: "https://example.com" };
      let requests = 0;
      await with_fetch(async () => deepseek_response(++requests === 1 ? status : 200, "0"), async () => {
        const result = await provider[method](input);
        assert.equal(result.provider, "deepseek");
        assert.equal(requests, 2);
      });
    }
  }
});

test("DeepSeek 最多重试两次并保留脱敏 HTTP 错误", async () => {
  let requests = 0;
  await with_fetch(async () => {
    requests += 1;
    return deepseek_response(429, "0");
  }, async () => {
    await assert.rejects(() => new DeepSeekSearchProvider({ api_key: "secret" }).search({ query: "test" }),
      (error) => error.message === "DeepSeek search failed with HTTP 429");
    assert.equal(requests, 3);
  });
});

test("DeepSeek 不重试其它 4xx、无效 JSON 或网络异常", async () => {
  for (const response of [
    ...[400, 401, 402, 403, 404, 413].map((status) => () => deepseek_response(status)),
    () => new Response("invalid-json"),
    () => { throw new Error("Mock transport failure"); },
  ]) {
    let requests = 0;
    await with_fetch(async () => { requests += 1; return response(); }, async () => {
      await assert.rejects(() => new DeepSeekSearchProvider({ api_key: "secret" }).search({ query: "test" }));
      assert.equal(requests, 1);
    });
  }
});

test("DeepSeek 尊重秒数与日期 Retry-After，等待超出总预算时直接返回最后错误", async () => {
  for (const retry_after of ["120", new Date(Date.now() + 120_000).toUTCString()]) {
    let requests = 0;
    await with_fetch(async () => { requests += 1; return deepseek_response(429, retry_after); }, async () => {
      await assert.rejects(() => new DeepSeekSearchProvider({ api_key: "secret", timeout_ms: 1_000 })
        .search({ query: "test" }), /HTTP 429/u);
      assert.equal(requests, 1);
    });
  }
});

test("DeepSeek 缺失或无效 Retry-After 使用递增且有抖动的退避", async () => {
  for (const retry_after of [undefined, "invalid"]) {
    const request_times = [];
    const random_values = [0, 0.5];
    const random_mock = mock.method(Math, "random", () => random_values.shift() ?? 0);
    try {
      await with_fetch(async () => {
        request_times.push(performance.now());
        return deepseek_response(request_times.length < 3 ? 500 : 200, retry_after);
      }, async () => {
        await new DeepSeekSearchProvider({ api_key: "secret" }).search({ query: "test" });
        assert.equal(request_times.length, 3);
        assert.ok(request_times[1] - request_times[0] >= 480);
        assert.ok(request_times[2] - request_times[1] >= 1_100);
      });
    } finally {
      random_mock.mock.restore();
    }
  }
});

test("DeepSeek 请求与重试共享总超时，等待中的第二次请求会被取消", async () => {
  let requests = 0;
  let second_signal;
  await with_fetch(async (_url, init) => {
    requests += 1;
    if (requests === 1) return deepseek_response(429, "0.1");
    second_signal = init.signal;
    return await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("Mock request aborted")), { once: true });
    });
  }, async () => {
    const started = performance.now();
    await assert.rejects(() => new DeepSeekSearchProvider({ api_key: "secret", timeout_ms: 1_000 })
      .search({ query: "test" }), /DeepSeek search timed out after 1000 ms/u);
    assert.equal(requests, 2);
    assert.equal(second_signal.aborted, true);
    assert.ok(performance.now() - started < 1_500);
  });
});

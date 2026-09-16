/**
 * @file 验证统一出站 HTTP 层的代理选择、超时语义与错误脱敏。
 *
 * 关键点（中文）
 * - 代理与超时是 Telegram 等 Channel 卡死问题的根因，必须有回归测试保护。
 * - 测试全部使用本地 HTTP Server，不依赖外网。
 */

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import {
  close_outbound_http_dispatchers,
  OutboundHttpError,
  outbound_http_fetch,
  outbound_http_json,
  resolve_outbound_proxy_url,
} from "../bin/http/OutboundHttp.js";

/**
 * 与插件 HTTP 层相关的全部代理环境变量。
 *
 * 关键点（中文）
 * - 必须与 PluginHttp 读取的变量名保持一一对应，否则测试会互相污染。
 * - 新增代理变量时同步补充此列表。
 */
const PROXY_ENV_KEYS = [
  "DOWNCITY_PROXY_URL",
  "DOWNCITY_NO_PROXY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

/** 运行一段逻辑，并在结束后恢复全部代理相关环境变量。 */
async function with_proxy_env(env, run) {
  const snapshot = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    await run();
  } finally {
    for (const [key, value] of snapshot) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await close_outbound_http_dispatchers();
  }
}

/** 启动一个测试用 HTTP Server，返回地址与关闭函数。 */
async function start_server(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * 启动一个支持 CONNECT 的最小 HTTP 代理。
 *
 * 说明（中文）
 * - undici ProxyAgent 对 http/https 目标都默认先建 CONNECT 隧道。
 * - `on_connect` 返回 false 时直接断开，用于模拟不可用代理。
 */
async function start_connect_proxy(on_connect, expected_port) {
  const server = http.createServer((_request, response) => {
    response.writeHead(405);
    response.end();
  });
  server.on("connect", (request, client_socket, head) => {
    const [host, port_text] = String(request.url || "").split(":");
    const port = Number(port_text);
    if (!on_connect(host, port) || port !== expected_port) {
      client_socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    const upstream = net.connect(port, host, () => {
      client_socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(client_socket);
      client_socket.pipe(upstream);
    });
    upstream.on("error", () => client_socket.end());
    client_socket.on("error", () => upstream.end());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("代理地址按 DOWNCITY_PROXY_URL 优先于通用变量解析", async () => {
  await with_proxy_env({}, async () => {
    assert.equal(resolve_outbound_proxy_url(), "");
  });
  await with_proxy_env({ HTTPS_PROXY: "http://127.0.0.1:8080" }, async () => {
    assert.equal(resolve_outbound_proxy_url(), "http://127.0.0.1:8080");
  });
  await with_proxy_env(
    {
      DOWNCITY_PROXY_URL: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:8080",
    },
    async () => {
      assert.equal(resolve_outbound_proxy_url(), "http://127.0.0.1:7890");
    },
  );
});

test("配置代理后请求经过代理隧道并正确解析", async () => {
  const tunnels = [];
  const target = await start_server((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  const target_port = Number(new URL(target.origin).port);
  // 一个最小可用的 HTTP 代理：只用 CONNECT 隧道转发，模拟 Clash/Squid 行为。
  const proxy = await start_connect_proxy((host, port) => {
    tunnels.push(`${host}:${port}`);
    return true;
  }, target_port);
  try {
    await with_proxy_env({ DOWNCITY_PROXY_URL: proxy.origin }, async () => {
      const payload = await outbound_http_json(`${target.origin}/health`);
      assert.deepEqual(payload, { ok: true });
      assert.deepEqual(tunnels, [`127.0.0.1:${target_port}`]);
    });
  } finally {
    await proxy.close();
    await target.close();
  }
});

test("NO_PROXY 命中的目标直连，不经过代理", async () => {
  const received = [];
  const proxy = await start_server((_request, response) => {
    received.push("proxied");
    response.writeHead(502);
    response.end();
  });
  const direct = await start_server((_request, response) => {
    received.push("direct");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ direct: true }));
  });
  try {
    await with_proxy_env(
      { DOWNCITY_PROXY_URL: proxy.origin, NO_PROXY: "127.0.0.1" },
      async () => {
        const payload = await outbound_http_json(`${direct.origin}/health`);
        assert.deepEqual(payload, { direct: true });
      },
    );
    assert.deepEqual(received, ["direct"]);
  } finally {
    await proxy.close();
    await direct.close();
  }
});

test("macOS 系统例外列表形式（CIDR 与 *.local）被正确识别", async () => {
  const received = [];
  const proxy = await start_server((_request, response) => {
    received.push("proxied");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ via: "proxy" }));
  });
  // 一个不可达的本地地址，只用于验证 CIDR 判定是否命中（命中则直连并快速失败）。
  const no_proxy = "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local";
  try {
    await with_proxy_env(
      { DOWNCITY_PROXY_URL: proxy.origin, DOWNCITY_NO_PROXY: no_proxy },
      async () => {
        // 127.0.0.1 命中例外，直连到不可达端口应当失败，而不是走代理拿到 200。
        await assert.rejects(
          () => outbound_http_fetch("http://127.0.0.1:1/health", { timeout_ms: 1_000 }),
          (error) => {
            assert.ok(error instanceof OutboundHttpError);
            // 命中例外时错误中不应出现代理地址。
            assert.equal(error.proxy_url, "");
            return true;
          },
        );
        // 内网网段命中 CIDR 例外，同样必须直连。
        await assert.rejects(
          () => outbound_http_fetch("http://10.1.2.3:1/health", { timeout_ms: 1_000 }),
          (error) => {
            assert.equal(error.proxy_url, "");
            return true;
          },
        );
        // 公网目标不在例外内，必须走代理。
        const payload = await outbound_http_json(`${proxy.origin}/health`);
        assert.deepEqual(payload, { via: "proxy" });
      },
    );
    assert.deepEqual(received, ["proxied"]);
  } finally {
    await proxy.close();
  }
});

test("请求超时抛出可展示的 timeout 错误且不再挂起", async () => {
  // 该 Server 建立连接后永不响应，用于验证整体超时。
  const hanging = await start_server(() => undefined);
  try {
    await with_proxy_env({}, async () => {
      const started_at = Date.now();
      await assert.rejects(
        () => outbound_http_fetch(`${hanging.origin}/hang`, { timeout_ms: 300 }),
        (error) => {
          assert.ok(error instanceof OutboundHttpError);
          assert.equal(error.code, "timeout");
          assert.match(error.message, /请求超时/u);
          assert.match(error.message, /配置网络代理/u);
          return true;
        },
      );
      assert.ok(Date.now() - started_at < 5_000);
    });
  } finally {
    await hanging.close();
  }
});

test("Telegram 风格的 endpoint 在错误信息中会脱敏 token", async () => {
  const hanging = await start_server(() => undefined);
  try {
    await with_proxy_env({}, async () => {
      await assert.rejects(
        () =>
          outbound_http_fetch(
            `${hanging.origin}/bot123456:SUPER_SECRET_TOKEN/getMe`,
            { method: "POST", timeout_ms: 200 },
          ),
        (error) => {
          assert.ok(error instanceof OutboundHttpError);
          assert.equal(error.endpoint.includes("SUPER_SECRET_TOKEN"), false);
          assert.equal(error.message.includes("SUPER_SECRET_TOKEN"), false);
          return true;
        },
      );
    });
  } finally {
    await hanging.close();
  }
});

test("不支持的 socks 代理会给出可执行的错误提示", async () => {
  await with_proxy_env({ DOWNCITY_PROXY_URL: "socks5://127.0.0.1:7890" }, async () => {
    await assert.rejects(
      () => outbound_http_fetch("http://127.0.0.1:1/health", { timeout_ms: 200 }),
      (error) => {
        assert.match(String(error.message), /暂不支持 socks5/u);
        return true;
      },
    );
  });
});

/**
 * 收下一个请求的完整请求体，供 multipart 断言使用。
 *
 * 说明（中文）
 * - 用 latin1 读取字节，避免二进制分段被 UTF-8 解码破坏。
 */
async function start_body_capture_server() {
  return await start_server((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          content_type: String(request.headers["content-type"] || ""),
          body: Buffer.concat(chunks).toString("latin1"),
        }),
      );
    });
  });
}

test("全局 FormData 请求体被编码为完整 multipart，文件名与分段类型不丢失", async () => {
  const target = await start_body_capture_server();
  let received;
  try {
    await with_proxy_env({}, async () => {
      const form = new FormData();
      form.set("chat_id", "123");
      form.set("caption", "说明文字");
      form.set(
        "document",
        new Blob([Buffer.from("# hello\n")], { type: "text/markdown" }),
        "prd.md",
      );
      form.set(
        "photo",
        new File([Buffer.from([0xff, 0xd8, 0xff])], "p.jpg", { type: "image/jpeg" }),
      );
      received = await outbound_http_json(`${target.origin}/sendDocument`, {
        method: "POST",
        body: form,
      });
    });

    // 关键点（中文）：修复前这里是 text/plain，body 只剩 "[object FormData]"，
    // Telegram / 飞书会因请求体缺少文件字段而返回 400。
    assert.match(received.content_type, /^multipart\/form-data; boundary=/u);
    assert.equal(received.body.includes("[object FormData]"), false);
    assert.match(received.body, /name="chat_id"\r\n\r\n123/u);
    assert.match(received.body, /name="document"; filename="prd\.md"/u);
    assert.match(received.body, /Content-Type: text\/markdown/u);
    assert.match(received.body, /name="photo"; filename="p\.jpg"/u);
    assert.match(received.body, /Content-Type: image\/jpeg/u);
    assert.match(received.body, /# hello/u);
  } finally {
    await target.close();
  }
});

test("multipart 附件上传在配置代理后仍经过代理隧道", async () => {
  const tunnels = [];
  const target = await start_body_capture_server();
  const target_port = Number(new URL(target.origin).port);
  const proxy = await start_connect_proxy((host, port) => {
    tunnels.push(`${host}:${port}`);
    return true;
  }, target_port);
  try {
    await with_proxy_env({ DOWNCITY_PROXY_URL: proxy.origin }, async () => {
      const form = new FormData();
      form.set(
        "document",
        new Blob([Buffer.from("payload")], { type: "text/plain" }),
        "a.txt",
      );
      const received = await outbound_http_json(`${target.origin}/upload`, {
        method: "POST",
        body: form,
      });
      // 关键点（中文）：归一化只改请求体，不能绕过代理与超时策略。
      assert.match(received.content_type, /^multipart\/form-data; boundary=/u);
      assert.match(received.body, /name="document"; filename="a\.txt"/u);
      assert.match(received.body, /payload/u);
      assert.deepEqual(tunnels, [`127.0.0.1:${target_port}`]);
    });
  } finally {
    await proxy.close();
    await target.close();
  }
});

test("非 FormData 请求体保持原有序列化语义", async () => {
  const target = await start_body_capture_server();
  try {
    await with_proxy_env({}, async () => {
      const json_body = await outbound_http_json(`${target.origin}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: 1 }),
      });
      assert.match(json_body.content_type, /^application\/json/u);
      assert.equal(json_body.body, '{"a":1}');

      const form_urlencoded = await outbound_http_json(`${target.origin}/token`, {
        method: "POST",
        body: new URLSearchParams({ grant_type: "client_credential" }),
      });
      assert.match(form_urlencoded.content_type, /^application\/x-www-form-urlencoded/u);
      assert.equal(form_urlencoded.body, "grant_type=client_credential");
    });
  } finally {
    await target.close();
  }
});

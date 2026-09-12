/**
 * @file 验证 Desktop 系统代理解析与 Global Env 代理回退。
 *
 * 关键点（中文）
 * - 系统代理继承是 Telegram 等 Channel 能否联网的关键路径，需要回归保护。
 * - 用例直接使用真实 `scutil --proxy` 输出格式，避免解析逻辑与系统行为脱节。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  parse_scutil_exceptions,
  parse_scutil_proxy,
  read_global_env_no_proxy,
  read_global_env_proxy_url,
  read_system_proxy,
} from "../src/main/settings/DesktopProxyResolver.ts";

/** 真实 macOS 系统代理输出样例。 */
const SCUTIL_HTTPS = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : 10.0.0.0/8
    3 : localhost
    4 : *.local
    5 : <local>
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 7890
  SOCKSProxy : 127.0.0.1
}
`;

test("scutil 输出优先解析出 HTTPS 代理", () => {
  const result = parse_scutil_proxy(SCUTIL_HTTPS);
  assert.equal(result.proxy_url, "http://127.0.0.1:7890");
});

test("scutil 例外列表转换为 NO_PROXY 规则并忽略 local 占位符", () => {
  const result = parse_scutil_proxy(SCUTIL_HTTPS);
  assert.equal(result.no_proxy, "127.0.0.1,192.168.0.0/16,10.0.0.0/8,localhost,*.local");
  assert.equal(result.no_proxy.includes("<local>"), false);
});

test("仅启用 HTTP 代理时回退到 HTTP 配置", () => {
  const result = parse_scutil_proxy(`<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : 10.0.0.2
  HTTPSEnable : 0
}
`);
  assert.equal(result.proxy_url, "http://10.0.0.2:8080");
});

test("系统未启用代理时返回空配置", () => {
  const result = parse_scutil_proxy(`<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 0
}
`);
  assert.equal(result.proxy_url, "");
});

test("只有 SOCKS 时不产出插件无法使用的代理地址", () => {
  // 说明（中文）：undici 不支持 socks，此时保持直连而不是给出坏地址。
  const result = parse_scutil_proxy(`<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 7890
  SOCKSProxy : 127.0.0.1
}
`);
  assert.equal(result.proxy_url, "");
});

test("没有例外列表时返回空 NO_PROXY", () => {
  assert.equal(parse_scutil_exceptions("<dictionary> {\n  HTTPEnable : 0\n}\n"), "");
});

test("Global Env 代理按 HTTPS 优先解析", () => {
  assert.equal(read_global_env_proxy_url({}), "");
  assert.equal(
    read_global_env_proxy_url({ HTTP_PROXY: "http://127.0.0.1:1080" }),
    "http://127.0.0.1:1080",
  );
  assert.equal(
    read_global_env_proxy_url({
      HTTPS_PROXY: "http://127.0.0.1:7890",
      HTTP_PROXY: "http://127.0.0.1:1080",
    }),
    "http://127.0.0.1:7890",
  );
});

test("Global Env NO_PROXY 兼容大小写变量名", () => {
  assert.equal(read_global_env_no_proxy({ no_proxy: "localhost" }), "localhost");
  assert.equal(read_global_env_no_proxy({ NO_PROXY: "127.0.0.1" }), "127.0.0.1");
});

test("read_system_proxy 在当前平台返回稳定结构", async () => {
  const result = await read_system_proxy();
  assert.equal(typeof result.proxy_url, "string");
  assert.equal(typeof result.no_proxy, "string");
  // 说明（中文）：解析出的地址必须能直接交给插件 HTTP 层使用。
  if (result.proxy_url) assert.match(result.proxy_url, /^https?:\/\//u);
});

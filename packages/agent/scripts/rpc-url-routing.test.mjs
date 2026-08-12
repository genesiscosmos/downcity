/**
 * @file 验证 RemoteAgent RPC URL 中的 Agent ID 会进入每个请求。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parse_rpc_url } from "../bin/remote/transports/RpcClient.js";

test("parse_rpc_url extracts an optional City Agent ID", () => {
  assert.deepEqual(parse_rpc_url("rpc://127.0.0.1:15314/lucas"), {
    host: "127.0.0.1",
    port: 15314,
    agent_id: "lucas",
  });
  assert.deepEqual(parse_rpc_url("rpc://127.0.0.1:15314"), {
    host: "127.0.0.1",
    port: 15314,
  });
  assert.throws(
    () => parse_rpc_url("rpc://127.0.0.1:15314/first/second"),
    /at most one Agent ID path segment/,
  );
});

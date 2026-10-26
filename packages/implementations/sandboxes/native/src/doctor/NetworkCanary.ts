/**
 * TCP 网络边界自检。
 *
 * 宿主仅启动自有 loopback 服务，不访问互联网或用户服务。
 * 同一端点必须先在 allow 策略中收到随机令牌，再在 deny 策略中被 OS 拒绝。
 * 启动失败、服务关闭、超时与未知连接错误都不能判定为隔离通过。
 * 这里只证明 TCP 到宿主 loopback 的边界，不声称覆盖 UDP、Unix socket 或域名过滤。
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type { SandboxProviderIssue } from "@downcity/type/shell";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";
import { run_probe_process } from "./ProbeProcess.js";

/** 探针仅将明确的权限或网络命名空间错误映射为预期拒绝，其他错误退出 78。 */
const network_probe_script = `
const net = require("node:net");
const socket = net.connect({ host: "127.0.0.1", port: Number(process.argv[1]) });
let received = "";
socket.setTimeout(2000, () => process.exit(78));
socket.on("data", (chunk) => { received += chunk; });
socket.on("end", () => process.exit(received === process.argv[2] ? 0 : 78));
socket.on("error", (error) => process.exit(
  ["EPERM", "EACCES", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(error.code) ? 77 : 78
));
`;

/** 验证允许策略的 TCP 连通性，以及禁止策略对同一端点的隔离。 */
export async function check_network_boundary(policy: ResolvedSandboxPolicy): Promise<SandboxProviderIssue[]> {
  const token = randomUUID();
  const server = createServer((socket) => {
    socket.on("error", () => undefined);
    socket.end(token);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP canary address");
    const invocation = {
      command: process.execPath,
      args: ["-e", network_probe_script, String(address.port), token],
    };
    if (await run_probe_process({ ...policy, network: "allow" }, invocation) !== 0) {
      return [{
        code: "network_allow_probe_failed",
        message: "Sandbox could not reach its own TCP canary under the allow policy",
        fixes: ["Check that the native sandbox can run Node and connect to its loopback probe."],
      }];
    }
    if (await run_probe_process({ ...policy, network: "deny" }, invocation) !== 77) {
      return [{
        code: "network_denial_not_enforced",
        message: "Sandbox did not demonstrate TCP isolation under the deny policy",
        fixes: ["Check the platform network policy; do not fall back to host execution."],
      }];
    }
    return [];
  } catch (error) {
    return [{
      code: "network_probe_failed",
      message: `TCP canary could not run: ${error instanceof Error ? error.message : String(error)}`,
      fixes: ["Check local loopback availability and the sandbox wrapper."],
    }];
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

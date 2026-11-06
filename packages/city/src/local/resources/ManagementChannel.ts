/**
 * 受本机用户权限保护的管理通道。它只调度显式注册的资源用例，
 * 不暴露远程 HTTP 管理、任意方法执行或文件访问。每次请求都核对实例和 root。
 * 普通 Session 订阅仍通过 City SDK transport，不在这里实现第二套 Session actor。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { CityHostState } from "../../city/host/CityHostRegistry.js";
import { as_resource_error, ResourceError } from "./ResourceError.js";
import { get_root_identity } from "./RootLease.js";

/** 本机管理协议版本；不兼容的客户端拒绝执行。 */
export const MANAGEMENT_VERSION = 1;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** 白名单用例调度，由宿主注入工厂和具体资源实现。 */
export interface ResourceDispatcher {
  /** 完整方法名集合，不接收任意对象路径。 */
  capabilities: readonly string[];
  /** 执行已验证身份的用例；input 由各用例继续校验。 */
  dispatch: (method: string, input: Record<string, unknown>) => Promise<unknown>;
}

/** 客户端提交的单次管理请求。 */
interface ManagementRequest {
  /** 请求标识，用于核对响应。 */
  id: string;
  /** 版本握手在每个请求上执行。 */
  version: number;
  /** 创建请求时已发现的宿主实例。 */
  instance_id: string;
  /** 已解析的数据根身份。 */
  root_identity: string;
  /** handshake 或显式资源用例。 */
  method: string;
  /** 业务参数，不含 transport 身份。 */
  input: Record<string, unknown>;
}

/** 独立管理监听的生命周期；不拥有 City 或业务数据库。 */
export class ManagementChannel {
  /** 向 host 描述发布的 socket / named pipe 地址。 */
  readonly endpoint: string;
  /** 已连接客户端，关闭时只断连接，不停止它们已提交的 Turn。 */
  private readonly sockets = new Set<Socket>();

  private constructor(private readonly server: Server, endpoint: string) { this.endpoint = endpoint; }

  /** 只在宿主持有 root 独占租约后调用。 */
  static async listen(root_path: string, state: CityHostState, dispatcher: ResourceDispatcher): Promise<ManagementChannel> {
    const identity = get_root_identity(root_path);
    const user_id = process.getuid?.() ?? os.userInfo().username;
    const directory = path.join(os.tmpdir(), `downcity-management-${user_id}`);
    let endpoint: string;
    if (process.platform === "win32") {
      endpoint = `\\\\.\\pipe\\downcity-${user_id}-${identity.slice(0, 24)}-${state.instance_id}`;
    } else {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
        throw new ResourceError("permission_denied", "Management socket directory is not owned by this user", 6);
      }
      await fs.chmod(directory, 0o700);
      endpoint = path.join(directory, `${identity.slice(0, 16)}-${state.instance_id.slice(0, 8)}.sock`);
    }
    const server = createServer();
    const channel = new ManagementChannel(server, endpoint);
    server.on("connection", (socket) => {
      channel.sockets.add(socket);
      socket.once("close", () => channel.sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      let buffer = "";
      let received = false;
      socket.setTimeout(30_000, () => { if (!received) socket.destroy(); });
      socket.on("data", (chunk) => {
        if (received) return;
        buffer += chunk.toString("utf8");
        if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) { socket.destroy(); return; }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        received = true;
        socket.setTimeout(0);
        void (async () => {
          let id: unknown = null;
          try {
            const request = JSON.parse(buffer.slice(0, newline)) as ManagementRequest;
            id = request.id;
            if (request.version !== MANAGEMENT_VERSION) throw new ResourceError("capability_missing", "Management protocol version is incompatible", 5);
            if (request.instance_id !== state.instance_id || request.root_identity !== identity) {
              throw new ResourceError("host_identity_mismatch", "City instance or root changed; discover the host again", 5);
            }
            const data = request.method === "handshake"
              ? { ...state, management_version: MANAGEMENT_VERSION, root_identity: identity, capabilities: dispatcher.capabilities }
              : dispatcher.capabilities.includes(request.method)
                ? await dispatcher.dispatch(request.method, request.input)
                : await Promise.reject(new ResourceError("capability_missing", `Unsupported resource method: ${request.method}`, 5));
            socket.end(`${JSON.stringify({ id, success: true, data })}\n`);
          } catch (error) {
            const failure = as_resource_error(error);
            socket.end(`${JSON.stringify({ id, success: false, error: { code: failure.code, message: failure.message, exit_code: failure.exit_code, retryable: failure.retryable, details: failure.details } })}\n`);
          }
        })();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint, () => { server.off("error", reject); resolve(); });
    });
    if (process.platform !== "win32") await fs.chmod(endpoint, 0o600);
    return channel;
  }

  /** 停止接收请求并关闭客户端，宿主负责先等待/释放实际业务资源。 */
  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    if (process.platform !== "win32") await fs.rm(this.endpoint, { force: true });
  }
}

/** 请求已发现的本机宿主；超时只断连接，不取消已提交的操作。 */
export async function request_management(
  state: CityHostState,
  root_path: string,
  method: string,
  input: Record<string, unknown> = {},
  timeout_ms = 30_000,
  abort_signal?: AbortSignal,
): Promise<unknown> {
  if (!state.management_endpoint || state.management_version !== MANAGEMENT_VERSION || state.state !== "ready") {
    throw new ResourceError("capability_missing", "Current City host does not expose a ready management channel", 5);
  }
  if (state.root_identity !== get_root_identity(root_path)) throw new ResourceError("host_identity_mismatch", "Discovered host belongs to another root", 5);
  return await new Promise((resolve, reject) => {
    const socket = createConnection(state.management_endpoint!);
    const id = randomUUID();
    let buffer = "";
    let settled = false;
    const finish = (error?: unknown, data?: unknown): void => {
      if (settled) return;
      settled = true;
      abort_signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error); else resolve(data);
    };
    const abort = (): void => finish(new ResourceError("cancelled", "Client interrupted; accepted host work continues", 130, false, { outcome: "unknown" }));
    abort_signal?.addEventListener("abort", abort, { once: true });
    if (abort_signal?.aborted) { abort(); return; }
    socket.setTimeout(timeout_ms, () => finish(new ResourceError("operation_timeout", "Management request timed out; an accepted operation may continue", 7, false, { outcome: "unknown" })));
    socket.once("connect", () => socket.write(`${JSON.stringify({ id, version: MANAGEMENT_VERSION, instance_id: state.instance_id, root_identity: state.root_identity, method, input })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) { finish(new ResourceError("internal_error", "Management response exceeds frame limit", 1)); return; }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const frame = JSON.parse(buffer.slice(0, newline));
        if (frame.id !== id) throw new ResourceError("host_identity_mismatch", "Management response identity mismatch", 5);
        if (frame.success !== true) {
          const error = frame.error;
          throw new ResourceError(error?.code ?? "internal_error", error?.message ?? "Management operation failed", error?.exit_code ?? 1, error?.retryable === true, error?.details ?? {});
        }
        finish(undefined, frame.data);
      } catch (error) { finish(error); }
    });
    socket.once("error", () => finish(new ResourceError("host_unreachable", "Current City management channel is unreachable", 5, true, { outcome: "unknown" })));
    socket.once("close", () => finish(new ResourceError("host_unreachable", "Management connection closed before a response", 5, true, { outcome: "unknown" })));
  });
}

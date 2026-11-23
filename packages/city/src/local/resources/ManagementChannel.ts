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
import { create_windows_management_key, read_windows_management_key, encode_management_frame, decode_management_frame } from "./WindowsManagementAuth.js";
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
  /** 宿主关闭时取消本 dispatcher 自有的响应句柄；不得关闭借用的 City 或数据库。 */
  dispose?: () => Promise<void>;
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
  /** 短时请求 nonce 的创建时间，用于认证通道防重放。 */
  issued_at: number;
}

/** 独立管理监听的生命周期；不拥有 City 或业务数据库。 */
export class ManagementChannel {
  /** 向 host 描述发布的 socket / named pipe 地址。 */
  readonly endpoint: string;
  /** 已连接客户端；关闭时保留已接受请求的连接直到响应结算。 */
  private readonly sockets = new Set<Socket>();
  /** 正在处理请求的连接，不把客户端断开误认为业务操作完成。 */
  private readonly active_sockets = new Set<Socket>();
  /** 已接受请求的结算边界，包含 dispatch 与响应编码。 */
  private readonly pending = new Set<Promise<void>>();
  /** 关闭开始后不再接受新的请求帧。 */
  private closing = false;
  /** 并发与重复 close 共享同一次关闭结果。 */
  private close_promise?: Promise<void>;

  private constructor(private readonly server: Server, endpoint: string, private readonly credential_path?: string) { this.endpoint = endpoint; }

  /** 只在宿主持有 root 独占租约后调用。 */
  static async listen(root_path: string, state: CityHostState, dispatcher: ResourceDispatcher): Promise<ManagementChannel> {
    const identity = get_root_identity(root_path);
    const user_id = process.getuid?.() ?? os.userInfo().username;
    const directory = path.join(os.tmpdir(), `downcity-management-${user_id}`);
    let endpoint: string;
    const auth_key = process.platform === "win32" ? await create_windows_management_key(root_path, state.instance_id) : undefined;
    const seen_requests = new Map<string, number>();
    if (process.platform === "win32") {
      endpoint = `\\\\.\\pipe\\downcity-${identity.slice(0, 24)}-${state.instance_id}`;
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
    const channel = new ManagementChannel(server, endpoint, auth_key ? path.join(root_path, "runtimes", "city", "management-auth", `${state.instance_id}.key`) : undefined);
    server.on("connection", (socket) => {
      if (channel.closing) { socket.destroy(); return; }
      channel.sockets.add(socket);
      socket.once("close", () => channel.sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      let buffer = "";
      let received = false;
      socket.setTimeout(30_000, () => { if (!received) socket.destroy(); });
      socket.on("data", (chunk) => {
        if (received) return;
        if (channel.closing) { socket.destroy(); return; }
        buffer += chunk.toString("utf8");
        if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) { socket.destroy(); return; }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        received = true;
        socket.setTimeout(0);
        channel.active_sockets.add(socket);
        const pending = Promise.resolve().then(async () => {
          let id: unknown = null;
          try {
            const request = decode_management_frame(buffer.slice(0, newline), auth_key) as ManagementRequest;
            id = request.id;
            if (auth_key) {
              const now = Date.now();
              for (const [key, time] of seen_requests) if (now - time > 60_000) seen_requests.delete(key);
              if (typeof request.id !== "string" || !Number.isFinite(request.issued_at) || Math.abs(now - request.issued_at) > 30_000 || seen_requests.has(request.id) || seen_requests.size >= 10_000) throw new ResourceError("unauthorized", "Expired or replayed management request", 6);
              seen_requests.set(request.id, now);
            }
            if (request.version !== MANAGEMENT_VERSION) throw new ResourceError("capability_missing", "Management protocol version is incompatible", 5);
            if (request.instance_id !== state.instance_id || request.root_identity !== identity) {
              throw new ResourceError("host_identity_mismatch", "City instance or root changed; discover the host again", 5);
            }
            const data = request.method === "handshake"
              ? { ...state, management_version: MANAGEMENT_VERSION, root_identity: identity, capabilities: dispatcher.capabilities }
              : dispatcher.capabilities.includes(request.method)
                ? await dispatcher.dispatch(request.method, request.input)
                : await Promise.reject(new ResourceError("capability_missing", `Unsupported resource method: ${request.method}`, 5));
            socket.end(`${encode_management_frame({ id, success: true, data }, auth_key)}\n`);
          } catch (error) {
            const failure = as_resource_error(error);
            socket.end(`${encode_management_frame({ id, success: false, error: { code: failure.code, message: failure.message, exit_code: failure.exit_code, retryable: failure.retryable, details: failure.details } }, auth_key)}\n`);
          }
        });
        channel.pending.add(pending);
        // 响应编码或连接异常也必须结算，避免未处理的 rejection 脱离关闭所有权。
        void pending.then(() => {
          channel.pending.delete(pending);
          channel.active_sockets.delete(socket);
        }, () => {
          channel.pending.delete(pending);
          channel.active_sockets.delete(socket);
          socket.destroy();
        });
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, () => { server.off("error", reject); resolve(); });
      });
      if (process.platform !== "win32") await fs.chmod(endpoint, 0o600);
      return channel;
    } catch (error) {
      // 监听成功后权限收敛仍可能失败，不能把已取得的句柄留给下一次启动。
      if (server.listening) {
        try { await channel.close(); }
        catch (cleanup_error) { throw new AggregateError([error, cleanup_error], "Management startup rollback failed"); }
      } else if (channel.credential_path) await fs.rm(channel.credential_path, { force: true });
      throw error;
    }
  }

  /**
   * 同步关闭接收门禁，等待已接受 dispatch 后关闭连接与本机凭据。
   * 宿主应从请求处理函数外调用，且在本方法结算后再释放业务数据库。
   */
  close(): Promise<void> {
    if (this.close_promise) return this.close_promise;
    this.closing = true;
    this.close_promise = this.finish_close();
    return this.close_promise;
  }

  /** 停止监听与业务结算分开等待，空闲客户端不能阻塞退出。 */
  private async finish_close(): Promise<void> {
    const listener_closed = new Promise<Error | undefined>((resolve) => {
      this.server.close((error) => resolve(error));
    });
    for (const socket of this.sockets) {
      if (!this.active_sockets.has(socket)) socket.destroy();
    }
    await Promise.allSettled([...this.pending]);
    for (const socket of this.sockets) socket.destroy();
    const listener_error = await listener_closed;
    if (process.platform !== "win32") await fs.rm(this.endpoint, { force: true });
    if (this.credential_path) await fs.rm(this.credential_path, { force: true });
    if (listener_error) throw listener_error;
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
  const auth_key = process.platform === "win32" ? await read_windows_management_key(root_path, state.instance_id) : undefined;
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
    socket.once("connect", () => socket.write(`${encode_management_frame({ id, issued_at: Date.now(), version: MANAGEMENT_VERSION, instance_id: state.instance_id, root_identity: state.root_identity, method, input }, auth_key)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) { finish(new ResourceError("internal_error", "Management response exceeds frame limit", 1)); return; }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const frame = decode_management_frame(buffer.slice(0, newline), auth_key) as {
          /** 呼应随机请求 ID，拒绝伪造或交叉响应。 */
          id: string;
          /** 本次业务语义是否成功。 */
          success: boolean;
          /** 成功业务对象。 */
          data?: unknown;
          /** 已认证的失败对象，保持错误协议。 */
          error?: { /** 机器错误码。 */ code?: string; /** 可展示文案。 */ message?: string; /** 退出码。 */ exit_code?: number; /** 可否原输入重试。 */ retryable?: boolean; /** 已提交事实。 */ details?: Record<string, unknown> };
        };
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

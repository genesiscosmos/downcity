/**
 * CLI/Desktop 共用的本机宿主连接。只读发现、完整握手后才允许请求；
 * 观察到宿主后任何身份/能力/连接失败都抛错，绝不取得根租约或装配另一 City。
 * 关闭只撤销客户端等待，不关闭、重启或释放被借用宿主。
 */
import { read_city_host_state, type CityHostState } from "../../city/host/CityHostRegistry.js";
import type { LocalHostClientOptions, LocalHostCallOptions, LocalHostSelection, LocalHostTransport } from "../types/LocalHostClient.js";
import { request_management, MANAGEMENT_VERSION } from "./ManagementChannel.js";
import { get_root_identity, resolve_resource_root } from "./RootLease.js";
import { ResourceError } from "./ResourceError.js";

const default_transport: LocalHostTransport = { discover: read_city_host_state, request: request_management };

/** 一次实例握手绑定一个客户端；宿主重启后的新实例须由调用方明确重新发现连接。 */
export class LocalHostClient {
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private close_promise?: Promise<void>;

  private constructor(readonly root_path: string, readonly state: Readonly<CityHostState>, readonly capabilities: readonly string[], private readonly transport: LocalHostTransport, private readonly caller_signal?: AbortSignal) {}

  /** 只在明确没有宿主时返回 null；故障不能被解释为离线。 */
  static async connect(options: LocalHostClientOptions = {}): Promise<LocalHostClient | null> {
    if (options.abort_signal?.aborted) throw new ResourceError("cancelled", "Client cancelled before host discovery", 130);
    const root_path = resolve_resource_root(options.root_path);
    const transport = options.transport ?? default_transport;
    const discovered = await transport.discover(root_path);
    if (options.abort_signal?.aborted) throw new ResourceError("cancelled", "Client cancelled during host discovery", 130);
    if (!discovered) return null;
    const identity = get_root_identity(root_path);
    if (discovered.root_identity !== identity) throw new ResourceError("host_identity_mismatch", "Discovered City belongs to another data root", 5);
    if (discovered.state !== "ready" || discovered.management_version !== MANAGEMENT_VERSION || !discovered.management_endpoint) throw new ResourceError("host_unreachable", "Current City host has no accessible ready management channel", 5);
    const response = await transport.request(discovered, root_path, "handshake", {}, options.handshake_timeout_ms ?? 5000, options.abort_signal);
    if (options.abort_signal?.aborted) throw new ResourceError("cancelled", "Client cancelled during host handshake", 130);
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new ResourceError("host_identity_mismatch", "City returned an invalid handshake", 5);
    const handshake = response as CityHostState;
    if (handshake.instance_id !== discovered.instance_id || handshake.root_identity !== identity || handshake.owner !== discovered.owner || handshake.pid !== discovered.pid || handshake.management_version !== MANAGEMENT_VERSION || handshake.state !== "ready") throw new ResourceError("host_identity_mismatch", "City identity changed during handshake", 5);
    if (!Array.isArray(handshake.capabilities) || handshake.capabilities.some((capability) => typeof capability !== "string" || !capability.trim())) throw new ResourceError("capability_missing", "Current City host returned no valid capability directory", 5);
    const client = new LocalHostClient(root_path, Object.freeze({ ...discovered }), Object.freeze([...new Set(handshake.capabilities)]), transport, options.abort_signal);
    client.require_capabilities(options.required_capabilities ?? []);
    return client;
  }

  /** 消费者先核对完整产品契约，不能静默转成只有扩展页可用的连接。 */
  require_capabilities(required: readonly string[]): void {
    const missing = required.filter((capability) => !this.capabilities.includes(capability));
    if (missing.length) throw new ResourceError("capability_missing", "Current City host does not provide the required client capabilities", 5, false, { missing_capabilities: missing });
  }

  /** 每次请求沿用同一实例/root身份与系统用户认证，不重发已提交业务。 */
  async call(method: string, input: Record<string, unknown> = {}, options: LocalHostCallOptions = {}): Promise<unknown> {
    if (this.controller.signal.aborted) throw new ResourceError("client_closed", "City client connection is closed", 5);
    this.require_capabilities([method]);
    const signals = [this.controller.signal, this.caller_signal, options.abort_signal].filter((signal): signal is AbortSignal => Boolean(signal));
    const signal = AbortSignal.any(signals);
    if (signal.aborted) throw new ResourceError("cancelled", "Client cancelled before request submission", 130, false, { outcome: "not_accepted" });
    const operation = this.transport.request(this.state, this.root_path, method, input, options.timeout_ms ?? 30000, signal);
    this.pending.add(operation);
    try { return await operation; } finally { this.pending.delete(operation); }
  }

  /** 只等待该客户端请求收口；不会调用宿主 shutdown 或释放宿主根租约。 */
  close(): Promise<void> {
    this.close_promise ??= (async () => {
      this.controller.abort(new Error("Local City client disconnected"));
      await Promise.allSettled([...this.pending]);
    })();
    return this.close_promise;
  }
}

/**
 * Desktop 启动组合根的唯一选择点。open_local 必须自行先取得独占租约并在租约内复查宿主；
 * 这里不启动任何进程。已经发现宿主但握手失败时，local factory 不会被调用。
 */
export async function select_local_host<TLocal>(options: LocalHostClientOptions, open_local: () => Promise<TLocal>): Promise<LocalHostSelection<TLocal>> {
  const client = await LocalHostClient.connect(options);
  if (client) return { mode: "connected", client };
  if (options.abort_signal?.aborted) throw new ResourceError("cancelled", "Client cancelled before local startup selection", 130);
  return { mode: "owned", local: await open_local() };
}

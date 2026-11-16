/** 本机共享宿主客户端的身份、传输与启动选择协议，不包含 City/DB 的所有权。 */
import type { CityHostState } from "../../city/host/CityHostRegistry.js";

/** 同机管理端口；生产使用受用户权限保护的管理通道，fixture 可注入内存端口。 */
export interface LocalHostTransport {
  /** 只读发现当前根的宿主，不创建租约或业务存储。 */
  discover(root_path: string): Promise<CityHostState | null>;
  /** 按已发现实例和根身份请求；取消等待不等于取消已接受业务。 */
  request(state: CityHostState, root_path: string, method: string, input: Record<string, unknown>, timeout_ms: number, signal?: AbortSignal): Promise<unknown>;
}

/** 连接策略明确区分离线和宿主不可达，后者禁止本地 fallback。 */
export interface LocalHostClientOptions {
  /** 显式数据根，缺省时遵循 DC_PLATFORM_ROOT 和默认根规则。 */
  root_path?: string;
  /** 该客户端必须由宿主提供的完整能力集合，握手时原子核对。 */
  required_capabilities?: readonly string[];
  /** 握手时限，毫秒。 */
  handshake_timeout_ms?: number;
  /** 客户端取消信号，不向宿主发 stop/shutdown。 */
  abort_signal?: AbortSignal;
  /** 当前同机传输；省略使用真实 ManagementChannel。 */
  transport?: LocalHostTransport;
}

/** 单次业务请求的等待策略。 */
export interface LocalHostCallOptions {
  /** 本次调用时限，默认 30 秒。 */
  timeout_ms?: number;
  /** 取消本次等待，不关闭同客户端其他请求。 */
  abort_signal?: AbortSignal;
}

/** 启动选择后唯一的所有权事实，连接已有宿主不能取得 City 的释放权。 */
export type LocalHostSelection<TLocal> = {
  /** 已有宿主模式。 */
  mode: "connected";
  /** 借用客户端，仅负责释放自己的连接。 */
  client: import("../resources/LocalHostClient.js").LocalHostClient;
} | {
  /** 无宿主，由组合根按显式启动授权创建本地资源。 */
  mode: "owned";
  /** 本地组合根唯一持有的资源，必须在独占租约内装配。 */
  local: TLocal;
};

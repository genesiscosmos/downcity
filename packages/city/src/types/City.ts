/**
 * City 生命周期类型。
 *
 * City 是一个 Store 下持久化 Agent 的运行时集合。查询方法返回可直接使用的 Agent，
 * 不向调用方暴露数据库记录或运行时装配细节。
 */

/** City 当前生命周期阶段。 */
export type CityState = "initializing" | "ready" | "disposed";

/** City 同时启动 HTTP 与 RPC transport 的监听参数。 */
export interface CityListenOptions {
  /** HTTP transport 监听参数；省略时不启动 HTTP。 */
  http?: {
    /** HTTP 监听地址。 */
    host?: string;
    /** HTTP 监听端口。 */
    port: number;
  };

  /** RPC transport 监听参数；省略时不启动 RPC。 */
  rpc?: {
    /** RPC 监听地址。 */
    host?: string;
    /** RPC 监听端口。 */
    port?: number;
  };
}

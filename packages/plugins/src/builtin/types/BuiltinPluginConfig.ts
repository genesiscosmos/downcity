/** Downcity 内置 Plugin 的静态配置类型。 */

/** Memory Plugin 的完整 profile。 */
export interface BuiltinMemoryPluginConfig {
  /** 当前启用的 Memory Provider。 */
  provider: "builtin";
  /** 当前启用的 Memory Storage。 */
  storage: "file";
  /** 可选的绝对存储目录；缺省时使用 Agent 独享目录。 */
  root_path?: string;
}

/** Web Plugin 的完整 profile。 */
export interface BuiltinWebPluginConfig {
  /** 浏览器 CDP WebSocket 或 HTTP 地址。 */
  cdp_url: string;
  /** 新建浏览器 Session 时使用的可选默认地址。 */
  default_url?: string;
  /** 单次浏览器操作的可选超时时间，单位为毫秒。 */
  timeout_ms?: number;
  /** 单次页面观察保留的最大字符数。 */
  max_observation_chars?: number;
}

/**
 * Native Sandbox Provider 公开配置类型。
 *
 * 这些参数只描述隔离环境的基础行为，不暴露平台细节，避免 Downcity 的公开 API
 * 与单一实现绑定。
 */

/** Native Sandbox Provider 构造参数。 */
export interface NativeProviderOptions {
  /** 隔离环境出网策略；省略时由 Workspace 绑定决定，默认允许。 */
  network?: "allow" | "deny";
}

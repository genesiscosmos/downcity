/**
 * Microsandbox Provider 公开配置类型。
 *
 * 这些参数只描述隔离环境的基础资源，不暴露 microsandbox 的底层构建器，避免
 * Downcity 的公开 API 与单一实现细节绑定。
 */

/** Microsandbox Provider 构造参数。 */
export interface MicrosandboxProviderOptions {
  /** Workspace Sandbox 使用的 OCI 镜像；默认包含 Node.js 22 与常用开发工具。 */
  image?: string;

  /** 每个 Workspace Sandbox 初始分配的虚拟 CPU 数量。 */
  cpus?: number;

  /** 每个 Workspace Sandbox 初始分配的内存，单位 MiB。 */
  memory_mib?: number;
}

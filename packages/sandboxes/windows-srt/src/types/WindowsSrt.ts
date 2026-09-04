/**
 * Windows SRT adapter 对外类型。
 *
 * 关键点（中文）：所有可配置字段都描述 Downcity 专属 Windows 安全域，调用方无需接触 srt-win 参数。
 */

/** Windows SRT adapter 构造参数。 */
export interface WindowsSrtSandboxOptions {
  /** SRT 创建并用于运行受限进程的本地 Windows 用户名。 */
  sandbox_user?: string;
  /** Downcity 专属 Windows Filtering Platform sublayer 标识。 */
  sublayer_guid?: string;
  /** WFP 允许本地过滤代理监听的闭区间端口范围。 */
  proxy_port_range?: readonly [number, number];
}

/** Windows SRT 安装参数。 */
export interface WindowsSrtInstallOptions extends WindowsSrtSandboxOptions {
  /** 是否替换与当前 Downcity 配置不一致的已有 SRT 安装。 */
  force?: boolean;
}

/** Windows SRT 单次受限进程启动描述。 */
export interface WindowsSrtSpawnDescriptor {
  /** 必须使用 shell=false 启动的完整参数数组。 */
  argv: string[];
  /** 启动 srt-win broker 使用的宿主环境。 */
  env: NodeJS.ProcessEnv;
  /** 子进程进入终态后必须调用一次的资源释放函数。 */
  release: () => void;
}

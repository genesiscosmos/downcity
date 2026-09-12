/**
 * 异步调度宿主环境判定。
 *
 * 关键点（中文）
 * - 进程内调度依赖「宿主进程长期存活」：定时器只在进程不退出的前提下才会触发。
 *   请求级隔离运行时（Edge / Worker）在响应结束后可能被回收，定时器不保证执行，
 *   因此必须先区分宿主的调度模型，不能一律使用进程内调度。
 * - 判定采用「正向识别已知的请求级运行时」，而不是反向识别 Node：
 *   本仓库部署的 Cloudflare Worker 启用了 `nodejs_compat`，`process` 与
 *   `process.versions.node` 都会存在，用 Node 特征反推会把 Worker 误判为长期进程。
 * - 未识别的宿主按长期进程处理（本地 Node、嵌入式 CLI/Desktop 都是这一档），
 *   并由部署模板显式声明外部队列来覆盖特殊运行时。
 */

/** 异步调度宿主模型。 */
export type FederationDispatchEnvironment =
  /** 长期运行进程：本地 Node、嵌入式 CLI 与 Desktop。 */
  | "long_lived"
  /** 请求级隔离运行时：Cloudflare Workers、Vercel Edge。 */
  | "request_scoped";

/** 判定当前宿主的调度模型。 */
export function detect_dispatch_environment(): FederationDispatchEnvironment {
  if (is_cloudflare_workers() || is_vercel_edge()) return "request_scoped";
  return "long_lived";
}

/** Cloudflare Workers 通过固定 userAgent 正向标识自身。 */
function is_cloudflare_workers(): boolean {
  return read_user_agent() === "Cloudflare-Workers";
}

/** Vercel Edge Runtime 通过 EdgeRuntime 全局正向标识自身。 */
function is_vercel_edge(): boolean {
  const runtime = (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  return typeof runtime === "string";
}

/** 读取 userAgent；缺失或非法时返回空字符串。 */
function read_user_agent(): string {
  const agent = (globalThis as { navigator?: { userAgent?: unknown } }).navigator
    ?.userAgent;
  return typeof agent === "string" ? agent : "";
}

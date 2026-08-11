/**
 * Workspace 项目路径规则模块。
 *
 * 职责说明（中文）
 * - 统一管理 Workspace 根目录下的 `.downcity` 运行时状态路径。
 * - 负责把“路径协议”集中到一个模块，避免各领域模块自行拼接字符串。
 * - 为初始化、日志、任务与调试文件等非 Store 子系统提供一致的路径入口。
 *
 * 边界说明（中文）
 * - 这里只负责路径计算，不负责目录创建、文件读写或存在性校验。
 * - 这里描述的是 Workspace 约定，不涉及 Agent Memory 或平台级全局目录布局。
 */
import path from "path";

/**
 * 返回项目运行时状态根目录 `.downcity` 的路径。
 */
export function get_downcity_dir_path(cwd: string): string {
  return path.join(cwd, ".downcity");
}

/**
 * 返回项目日志目录路径。
 */
export function get_logs_dir_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), "logs");
}

/**
 * 返回项目缓存目录路径。
 *
 * 关键点（中文）
 * - 当前使用隐藏命名 `.cache`，避免与用户业务目录混淆。
 */
export function get_cache_dir_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), ".cache");
}

/**
 * Plugin Schedule JSONL 路径。
 *
 * 关键点（中文）
 * - 调度任务属于项目 runtime 本地状态，因此放在项目 `.downcity/` 下。
 */
export function get_downcity_schedule_db_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), "schedule.jsonl");
}

/**
 * 返回项目运行时数据目录路径。
 */
export function get_downcity_data_dir_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), "data");
}

/**
 * 返回项目公开静态资源目录路径。
 */
export function get_downcity_public_dir_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), "public");
}

/**
 * 返回项目任务目录路径。
 *
 * 关键点（中文）
 * - 该目录用于存放任务相关的本地文件与运行时数据。
 */
export function get_downcity_tasks_dir_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), "task");
}

/**
 * 返回项目调试目录路径。
 *
 * 关键点（中文）
 * - 当前使用隐藏目录 `.debug`，避免与用户显式业务目录冲突。
 */
export function get_downcity_debug_dir_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), ".debug");
}

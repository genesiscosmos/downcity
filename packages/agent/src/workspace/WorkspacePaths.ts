/**
 * AgentWorkspace 内部数据路径规则模块。
 *
 * 职责说明（中文）
 * - 统一管理 Agent 根目录下的运行时状态路径。
 * - 负责把“路径协议”集中到一个模块，避免各领域模块自行拼接字符串。
 * - 为初始化、日志、任务与调试文件等非 Store 子系统提供一致的路径入口。
 *
 * 边界说明（中文）
 * - 这里只负责路径计算，不负责目录创建、文件读写或存在性校验。
 * - 这里描述的是 Agent 私有数据约定，不涉及项目目录或平台级全局目录布局。
 */
import path from "path";

/**
 * 返回 Agent 内部数据根目录。
 */
export function get_downcity_dir_path(data_path: string): string {
  return path.resolve(data_path);
}

/**
 * 返回项目日志目录路径。
 */
export function get_logs_dir_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), "logs");
}

/**
 * Plugin Schedule JSONL 路径。
 *
 * 关键点（中文）
 * - 调度任务属于 Agent，因此放在 Agent 集中式内部数据目录。
 */
export function get_downcity_schedule_db_path(cwd: string): string {
  return path.join(get_downcity_dir_path(cwd), "schedule.jsonl");
}

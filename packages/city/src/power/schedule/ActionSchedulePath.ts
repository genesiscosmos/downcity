/** City Power ActionSchedule 的持久化路径规则。 */

import path from "node:path";

/** 返回指定 Agent 私有存储中的 ActionSchedule JSONL 路径。 */
export function get_downcity_schedule_db_path(storage_root_path: string): string {
  return path.join(path.resolve(storage_root_path), "schedule.jsonl");
}

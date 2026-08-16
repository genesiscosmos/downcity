/** City 数据库重置命令。 */

import { get_local_database_path, resolve_local_root_path } from "@downcity/local";
import { stop_daemon_process } from "@/city/process/daemon/Manager.js";
import { reset_city_database } from "@/city/runtime/CityReset.js";
import prompts from "@/city/tui/Prompts.js";
import { emitCliBlock } from "@/shared/CliReporter.js";

/** 确认并重置 CLI 与 Desktop 共用的本地配置数据库。 */
export async function city_reset(options: { yes?: boolean }): Promise<void> {
  const root_path = resolve_local_root_path();
  const database_path = get_local_database_path(root_path);
  if (!options.yes) {
    const answer = await prompts({
      type: "confirm",
      name: "confirmed",
      message: "Reset all Downcity database configuration?",
      subtitle: database_path,
      initial: false,
    });
    if (answer.confirmed !== true) {
      emitCliBlock({ tone: "info", title: "City reset cancelled" });
      return;
    }
  }

  const daemon = await stop_daemon_process();
  const removed_files = await reset_city_database(root_path);
  emitCliBlock({
    tone: "success",
    title: "City database reset",
    summary: database_path,
    facts: [
      { label: "daemon", value: daemon.stopped ? "stopped" : "not running" },
      { label: "files", value: String(removed_files.length) },
    ],
    note: "Environment, Agent/Plugin configuration, Workspace files and Session files were preserved.",
  });
}

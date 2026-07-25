/**
 * Control 概览路由。
 *
 * 关键点（中文）
 * - 聚合 overview 与 plugin 运行态两块轻量只读接口。
 * - 只负责路由层拼装，不承载复杂业务状态机。
 */

import fs from "fs-extra";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { listPluginStates } from "@downcity/agent";
import { buildControlRouteAliases, toLimit } from "@/city/agent/control/CommonHelpers.js";
import { list_control_session_summaries, readRecentLogs } from "@/city/agent/control/Helpers.js";
import type { ControlRouteRegistrationParams } from "@/city/agent/http/control/types/ControlRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 当前 DC 版本号（用于 Overview 显示）。
 */
const DC_VERSION = (() => {
  try {
    const pkg = fs.readJsonSync(join(__dirname, "../../../package.json")) as {
      version?: string;
    };
    const version = String(pkg?.version || "").trim();
    return version || "unknown";
  } catch {
    return "unknown";
  }
})();

/**
 * 注册概览与运行态 plugin 路由。
 */
export function registerControlOverviewRoutes(
  params: ControlRouteRegistrationParams,
): void {
  const { app } = params;

  for (const routePath of buildControlRouteAliases("/overview")) {
    app.get(routePath, async (c) => {
      try {
        const runtime = params.getAgentContext();
        const sessionLimit = toLimit(
          c.req.query("sessionLimit") || c.req.query("contextLimit"),
          20,
        );
        const sessions = await list_control_session_summaries(
          runtime.sessions,
          sessionLimit,
        );
        const runtimePlugins = listPluginStates({
          context: params.getAgentContext(),
        });
        const taskResult = await params.getAgentContext().plugins.runAction({
          plugin: "task",
          action: "list",
        });
        const taskData =
          taskResult.data && typeof taskResult.data === "object" && !Array.isArray(taskResult.data)
            ? taskResult.data as { tasks?: Array<{ status?: string }> }
            : {};
        const tasks = Array.isArray(taskData.tasks) ? taskData.tasks : [];
        const logs = await readRecentLogs({
          projectRoot: runtime.rootPath,
          limit: 50,
        });

        const statusCount = {
          enabled: tasks.filter((x) => x.status === "enabled").length,
          paused: tasks.filter((x) => x.status === "paused").length,
          disabled: tasks.filter((x) => x.status === "disabled").length,
        };

        return c.json({
          success: true,
          cityVersion: DC_VERSION,
          now: new Date().toISOString(),
          agent: {
            id: runtime.agent_id,
            status: "running",
          },
          sessions: {
            total: sessions.length,
            items: sessions,
          },
          plugins: runtimePlugins,
          tasks: {
            total: tasks.length,
            statusCount,
          },
          logs,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/plugins/list")) {
    app.get(routePath, (c) => {
      return c.json({
        success: true,
        plugins: listPluginStates({
          context: params.getAgentContext(),
        }),
      });
    });
  }
}

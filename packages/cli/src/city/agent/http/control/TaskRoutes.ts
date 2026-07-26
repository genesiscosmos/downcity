/**
 * Control 任务与日志路由。
 *
 * 关键点（中文）
 * - 聚合 tasks/runs/logs 相关接口。
 * - 任务动作统一复用 task plugin runtime command，不在 UI 层重复实现业务语义。
 */

import fs from "fs-extra";
import { basename, dirname, join } from "path";
import { getDowncityTasksDirPath } from "@/city/config/Paths.js";
import type { ControlRouteRegistrationParams } from "@/city/agent/http/control/types/ControlRoutes.js";
import {
  buildControlRouteAliases,
  decodeMaybe,
  toLimit,
  toOptionalString,
} from "@/city/agent/control/CommonHelpers.js";
import {
  TASK_RUN_DIR_REGEX,
  listTaskRuns,
  readRecentLogs,
  readTaskRunDetail,
} from "@/city/agent/control/Helpers.js";

type TaskListItem = {
  title?: string;
  status?: string;
  taskMdPath?: string;
  lastRunTimestamp?: string;
  [key: string]: unknown;
};

function resolveTaskIdFromTaskMdPath(taskMdPath: unknown): string {
  const text = String(taskMdPath || "").trim();
  if (!text) return "";
  return basename(dirname(text));
}

async function listTasksViaPlugin(params: {
  routes: ControlRouteRegistrationParams;
  status?: string;
}): Promise<TaskListItem[]> {
  const result = await params.routes.get_agent().plugins.run_action({
    plugin: "task",
    action: "list",
    payload: params.status ? { status: params.status } : undefined,
  });
  if (!result.success) {
    throw new Error(result.error || result.message || "task list failed");
  }
  const data =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as { tasks?: TaskListItem[] }
      : {};
  return Array.isArray(data.tasks) ? data.tasks : [];
}

async function resolveTaskIdByTitleViaPlugin(params: {
  routes: ControlRouteRegistrationParams;
  title: string;
}): Promise<string> {
  const title = String(params.title || "").trim();
  const tasks = await listTasksViaPlugin({ routes: params.routes });
  const matched = tasks.filter((task) => String(task.title || "").trim() === title);
  if (matched.length !== 1) throw new Error(`Task not found: ${title}`);
  const taskId = resolveTaskIdFromTaskMdPath(matched[0]?.taskMdPath);
  if (!taskId) throw new Error(`Task id not found: ${title}`);
  return taskId;
}

/**
 * 读取任务当前是否仍在执行。
 */
async function readTaskRunningState(params: {
  project_root: string;
  routes: ControlRouteRegistrationParams;
  title: string;
  lastRunTimestamp?: string;
}): Promise<boolean> {
  const title = String(params.title || "").trim();
  const timestamp = String(params.lastRunTimestamp || "").trim();
  if (!title || !timestamp || !TASK_RUN_DIR_REGEX.test(timestamp)) return false;

  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitleViaPlugin({
      routes: params.routes,
      title,
    });
  } catch {
    return false;
  }

  const progressPath = join(
    getDowncityTasksDirPath(params.project_root),
    taskId,
    timestamp,
    "run-progress.json",
  );
  const progress = (await fs.readJson(progressPath).catch(() => null)) as {
    status?: string;
  } | null;
  return String(progress?.status || "").trim().toLowerCase() === "running";
}

/**
 * 注册任务与日志路由。
 */
export function registerControlTaskRoutes(
  params: ControlRouteRegistrationParams,
): void {
  const { app } = params;

  for (const routePath of buildControlRouteAliases("/tasks")) {
    app.get(routePath, async (c) => {
      try {
        const runtime = params.get_agent();
        const status = toOptionalString(c.req.query("status"));
        const tasks = await listTasksViaPlugin({
          routes: params,
          ...(status ? { status } : {}),
        });
        const tasksWithRunning = await Promise.all(
          tasks.map(async (task) => {
            const running = await readTaskRunningState({
              project_root: runtime.workspace.path,
              routes: params,
              title: String(task.title || "").trim(),
              lastRunTimestamp: task.lastRunTimestamp,
            });
            return running ? { ...task, running } : task;
          }),
        );
        return c.json({
          success: true,
          tasks: tasksWithRunning,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/tasks/run")) {
    app.post(routePath, async (c) => {
      try {
        const body = (await c.req.json().catch(() => ({}))) as {
          title?: string;
          reason?: string;
        };
        const title = String(body.title || "").trim();
        if (!title) {
          return c.json({ success: false, error: "Invalid title" }, 400);
        }

        const reason = toOptionalString(body.reason);
        const result = await params.get_agent().plugins.run_action({
          plugin: "task",
          action: "run",
          payload: {
            title,
            ...(reason ? { reason } : {}),
          },
        });
        return c.json(result, result.success ? 200 : 400);
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/tasks/:title/status")) {
    app.post(routePath, async (c) => {
      try {
        const title = decodeMaybe(String(c.req.param("title") || "").trim());
        const body = (await c.req.json().catch(() => ({}))) as {
          status?: string;
        };
        const status = String(body.status || "").trim();
        if (!title) {
          return c.json({ success: false, error: "Invalid title" }, 400);
        }
        if (!["enabled", "paused", "disabled"].includes(status)) {
          return c.json({ success: false, error: "Invalid status" }, 400);
        }

        const result = await params.get_agent().plugins.run_action({
          plugin: "task",
          action: "status",
          payload: {
            title,
            status,
          },
        });
        if (!result.success) {
          return c.json(
            { success: false, error: result.error || result.message || "task status update failed" },
            400,
          );
        }
        const data =
          result.data && typeof result.data === "object" && !Array.isArray(result.data)
            ? result.data
            : {};
        return c.json({
          success: true,
          ...data,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/tasks/:title")) {
    app.delete(routePath, async (c) => {
      try {
        const title = decodeMaybe(String(c.req.param("title") || "").trim());
        if (!title) {
          return c.json({ success: false, error: "Invalid title" }, 400);
        }

        const result = await params.get_agent().plugins.run_action({
          plugin: "task",
          action: "delete",
          payload: {
            title,
          },
        });
        if (!result.success) {
          return c.json({ success: false, error: result.error || result.message || "task delete failed" }, 400);
        }
        const data =
          result.data && typeof result.data === "object" && !Array.isArray(result.data)
            ? result.data
            : {};
        return c.json({
          success: true,
          ...data,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/tasks/:title/runs/:timestamp")) {
    app.delete(routePath, async (c) => {
      try {
        const runtime = params.get_agent();
        const title = decodeMaybe(String(c.req.param("title") || "").trim());
        const timestamp = String(c.req.param("timestamp") || "").trim();
        if (!title) {
          return c.json({ success: false, error: "Invalid title" }, 400);
        }
        if (!TASK_RUN_DIR_REGEX.test(timestamp)) {
          return c.json({ success: false, error: "Invalid timestamp" }, 400);
        }

        let taskId = "";
        try {
          taskId = await resolveTaskIdByTitleViaPlugin({
            routes: params,
            title,
          });
        } catch {
          return c.json({ success: false, error: "Task not found" }, 404);
        }
        const runDir = join(getDowncityTasksDirPath(runtime.workspace.path), taskId, timestamp);
        if (!(await fs.pathExists(runDir))) {
          return c.json({ success: false, error: "Run not found" }, 404);
        }

        const progressPath = join(runDir, "run-progress.json");
        const progress = (await fs.readJson(progressPath).catch(() => null)) as {
          status?: string;
        } | null;
        if (String(progress?.status || "").trim().toLowerCase() === "running") {
          return c.json(
            { success: false, error: "Run is still in progress and cannot be deleted" },
            409,
          );
        }

        await fs.remove(runDir);
        return c.json({
          success: true,
          title,
          timestamp,
          deleted: true,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/tasks/:title/runs")) {
    app.delete(routePath, async (c) => {
      try {
        const runtime = params.get_agent();
        const title = decodeMaybe(String(c.req.param("title") || "").trim());
        if (!title) {
          return c.json({ success: false, error: "Invalid title" }, 400);
        }

        let taskId = "";
        try {
          taskId = await resolveTaskIdByTitleViaPlugin({
            routes: params,
            title,
          });
        } catch {
          return c.json({ success: false, error: "Task not found" }, 404);
        }

        const taskDir = join(getDowncityTasksDirPath(runtime.workspace.path), taskId);
        if (!(await fs.pathExists(taskDir))) {
          return c.json({
            success: true,
            title,
            deletedCount: 0,
            skippedRunningCount: 0,
            deletedTimestamps: [],
            skippedRunningTimestamps: [],
          });
        }

        const entries = await fs.readdir(taskDir, { withFileTypes: true });
        const timestamps = entries
          .filter((x) => x.isDirectory() && TASK_RUN_DIR_REGEX.test(x.name))
          .map((x) => x.name)
          .sort();
        const deletedTimestamps: string[] = [];
        const skippedRunningTimestamps: string[] = [];

        for (const timestamp of timestamps) {
          const runDir = join(taskDir, timestamp);
          const progressPath = join(runDir, "run-progress.json");
          const progress = (await fs.readJson(progressPath).catch(() => null)) as {
            status?: string;
          } | null;
          if (String(progress?.status || "").trim().toLowerCase() === "running") {
            skippedRunningTimestamps.push(timestamp);
            continue;
          }
          await fs.remove(runDir);
          deletedTimestamps.push(timestamp);
        }

        return c.json({
          success: true,
          title,
          deletedCount: deletedTimestamps.length,
          skippedRunningCount: skippedRunningTimestamps.length,
          deletedTimestamps,
          skippedRunningTimestamps,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });

    app.get(routePath, async (c) => {
      try {
        const runtime = params.get_agent();
        const title = decodeMaybe(String(c.req.param("title") || "").trim());
        if (!title) {
          return c.json({ success: false, error: "Invalid title" }, 400);
        }

        const limit = toLimit(c.req.query("limit"), 50);
        const runs = await listTaskRuns({
          project_root: runtime.workspace.path,
          title,
          limit,
        });
        return c.json({ success: true, title, runs });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/tasks/:title/runs/:timestamp")) {
    app.get(routePath, async (c) => {
      try {
        const runtime = params.get_agent();
        const title = decodeMaybe(String(c.req.param("title") || "").trim());
        const timestamp = String(c.req.param("timestamp") || "").trim();
        if (!title) {
          return c.json({ success: false, error: "Invalid title" }, 400);
        }
        if (!TASK_RUN_DIR_REGEX.test(timestamp)) {
          return c.json({ success: false, error: "Invalid timestamp" }, 400);
        }

        const detail = await readTaskRunDetail({
          project_root: runtime.workspace.path,
          title,
          timestamp,
        });
        if (!detail) {
          return c.json({ success: false, error: "Run not found" }, 404);
        }
        return c.json({ success: true, ...detail });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/logs")) {
    app.get(routePath, async (c) => {
      try {
        const runtime = params.get_agent();
        const limit = toLimit(c.req.query("limit"), 200);
        const logs = await readRecentLogs({
          project_root: runtime.workspace.path,
          limit,
        });
        return c.json({
          success: true,
          logs,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }
}

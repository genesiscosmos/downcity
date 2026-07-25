/**
 * Task 调度注册（集成层）。
 *
 * 关键点（中文）
 * - task 语义（status/when/串行保护）放在 task plugin runtime。
 * - cron 调度执行器由宿主注入，task runtime 不依赖具体实现。
 */

import type { PluginContext } from "@downcity/agent";
import {
  isTaskWhenManual,
  resolveTaskWhenCronExpression,
  resolveTaskWhenOneShotMs,
} from "./runtime/Model.js";
import { listTasks, readTask, writeTask } from "./runtime/Store.js";
import { runTaskNow } from "./runtime/Runner.js";
import { TaskCronEngine } from "./types/Cron.js";

const TASK_LOG_PREFIX = "[TASK]";

function formatTaskLogMessage(message: string): string {
  return `${TASK_LOG_PREFIX} ${message}`;
}

export async function registerTaskCronJobs(params: {
  context: PluginContext;
  engine: TaskCronEngine;
  /**
   * cron 表达式使用的 IANA 时区。
   */
  timezone: string;
  /**
   * 当前 TaskPlugin 实例持有的运行中 task 锁。
   */
  runningTaskIds: Set<string>;
}): Promise<{ tasksFound: number; jobsScheduled: number }> {
  const context = params.context;
  const logger = context.logger;
  const tasks = await listTasks(context.workspace_path);
  const runtimeTimezone = params.timezone;

  let jobsScheduled = 0;

  for (const item of tasks) {
    if (String(item.status).toLowerCase() !== "enabled") continue;

    const expr = resolveTaskWhenCronExpression(item.when);
    let latestWhen = item.when;
    try {
      const task = await readTask({
        taskId: item.taskId,
        project_root: context.workspace_path,
      });
      latestWhen = task.frontmatter.when;
    } catch {}

    if (expr && !isTaskWhenManual(item.when)) {
      try {
        params.engine.register({
          id: `task:${item.taskId}`,
          expression: expr,
          timezone: runtimeTimezone,
          execute: async () => {
            const taskId = String(item.taskId || "").trim();
            if (!taskId) return;

            // 关键点（中文）：同一 taskId 串行；重叠触发时跳过，避免并发执行污染 run 目录。
            if (params.runningTaskIds.has(taskId)) {
              void logger.log("warn", formatTaskLogMessage("Task skipped (already running)"), {
                taskId,
                via: "cron",
              });
              return;
            }

            params.runningTaskIds.add(taskId);
            try {
              // 关键点（中文）：触发瞬间复查最新 task.md，避免 status/when 变更后仍沿用旧注册状态。
              const latest = await readTask({
                taskId,
                project_root: context.workspace_path,
              });
              if (String(latest.frontmatter.status).toLowerCase() !== "enabled") {
                return;
              }
              const latestExpr = resolveTaskWhenCronExpression(latest.frontmatter.when);
              if (!latestExpr || isTaskWhenManual(latest.frontmatter.when)) {
                return;
              }

              const result = await runTaskNow({
                context,
                taskId,
                project_root: context.workspace_path,
                trigger: { type: "cron" },
              });

              void logger.log("info", formatTaskLogMessage("Task run finished"), {
                taskId,
                via: "cron",
                status: result.status,
                executionStatus: result.executionStatus,
                resultStatus: result.resultStatus,
                ...(result.resultErrors.length > 0
                  ? { resultErrors: result.resultErrors }
                  : {}),
                dialogueRounds: result.dialogueRounds,
                userSimulatorSatisfied: result.userSimulatorSatisfied,
                timestamp: result.timestamp,
                runDir: result.runDirRel,
              });
            } catch (error) {
              void logger.log("error", formatTaskLogMessage("Task run failed (scheduler)"), {
                taskId,
                via: "cron",
                error: String(error),
              });
            } finally {
              params.runningTaskIds.delete(taskId);
            }
          },
        });

        jobsScheduled += 1;
      } catch {
        void logger.log("warn", formatTaskLogMessage("Invalid task cron; skipped"), {
          taskId: item.taskId,
          when: item.when,
        });
      }
    }

    const plannedTimeMs = resolveTaskWhenOneShotMs(latestWhen);
    if (String(latestWhen || "").trim() && String(latestWhen || "").toLowerCase().startsWith("time:") && plannedTimeMs === null) {
      void logger.log("warn", formatTaskLogMessage("Invalid task one-shot time; skipped"), {
        taskId: item.taskId,
        when: latestWhen,
      });
      continue;
    }
    if (plannedTimeMs === null) continue;

    try {
      params.engine.register({
        id: `task-time:${item.taskId}`,
        expression: "* * * * *",
        timezone: runtimeTimezone,
        execute: async () => {
          const taskId = String(item.taskId || "").trim();
          if (!taskId) return;

          // 到点前不执行；进程重启后若已过点，将在下一分钟补执行一次。
          if (Date.now() < plannedTimeMs) return;

          // 关键点（中文）：同一 taskId 串行；重叠触发时跳过，避免并发执行污染 run 目录。
          if (params.runningTaskIds.has(taskId)) {
            void logger.log("warn", formatTaskLogMessage("Task skipped (already running)"), {
              taskId,
              via: "time",
            });
            return;
          }

          let shouldDeactivateOneShot = false;
          params.runningTaskIds.add(taskId);
          try {
            const latest = await readTask({
              taskId,
              project_root: context.workspace_path,
            });
            if (String(latest.frontmatter.status).toLowerCase() !== "enabled") return;
            const latestPlannedMs = resolveTaskWhenOneShotMs(latest.frontmatter.when);
            if (latestPlannedMs === null) return;
            if (Date.now() < latestPlannedMs) return;

            shouldDeactivateOneShot = true;
            const result = await runTaskNow({
              context,
              taskId,
              project_root: context.workspace_path,
              trigger: { type: "time" },
            });

            void logger.log("info", formatTaskLogMessage("Task run finished"), {
              taskId,
              via: "time",
              status: result.status,
              executionStatus: result.executionStatus,
              resultStatus: result.resultStatus,
              ...(result.resultErrors.length > 0
                ? { resultErrors: result.resultErrors }
                : {}),
              dialogueRounds: result.dialogueRounds,
              userSimulatorSatisfied: result.userSimulatorSatisfied,
              timestamp: result.timestamp,
              runDir: result.runDirRel,
            });
          } catch (error) {
            void logger.log("error", formatTaskLogMessage("Task run failed (scheduler)"), {
              taskId,
              via: "time",
              error: String(error),
            });
          } finally {
            if (shouldDeactivateOneShot) {
              try {
                const latest = await readTask({
                  taskId,
                  project_root: context.workspace_path,
                });
                await writeTask({
                  project_root: context.workspace_path,
                  taskId,
                  overwrite: true,
                  frontmatter: {
                    ...latest.frontmatter,
                    when: "@manual",
                    status: "paused",
                  },
                  body: latest.body,
                });
                void logger.log("info", formatTaskLogMessage("One-shot task deactivated after execution"), {
                  taskId,
                  status: "paused",
                });
              } catch (e) {
                void logger.log("warn", formatTaskLogMessage("Failed to deactivate one-shot task"), {
                  taskId,
                  error: String(e),
                });
              }
            }
            params.runningTaskIds.delete(taskId);
          }
        },
      });

      jobsScheduled += 1;
    } catch {
      void logger.log("warn", formatTaskLogMessage("Invalid task one-shot trigger; skipped"), {
        taskId: item.taskId,
        when: latestWhen,
      });
    }
  }

  return {
    tasksFound: tasks.length,
    jobsScheduled,
  };
}

/**
 * TaskPowerActions：task power runtime 的 action 注册表模块。
 *
 * 关键点（中文）
 * - 这里专门负责把 task 的 CLI/execute 定义装配成 `PowerActions`。
 * - task power runtime 本体只保留实例状态与 lifecycle，不再承载大段 action 声明。
 */

import type { Command } from "commander";
import type { PowerActions, PowerNotificationPublisher, PowerStorage } from "@downcity/city/power";
import { create_action } from "@downcity/city/power";
import { z } from "zod";
import type { TaskListActionPayload } from "@/task/types/TaskPowerTypes.js";
import type {
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskRunDetailRequest,
  TaskRunHistoryRequest,
  TaskRunRequest,
  TaskSetStatusRequest,
  TaskUpdateRequest,
} from "@/task/types/TaskCommand.js";
import {
  executeTaskCreateAction,
  executeTaskDeleteAction,
  executeTaskListAction,
  executeTaskRunAction,
  executeTaskStatusAction,
  executeTaskUpdateAction,
  execute_task_history_action,
  execute_task_run_detail_action,
  type TaskSchedulerReloadPort,
} from "./TaskActionExecution.js";
import {
  mapTaskCreateCommandPayload,
  mapTaskDeleteCommandPayload,
  mapTaskDisableCommandPayload,
  mapTaskEnableCommandPayload,
  mapTaskListCommandPayload,
  mapTaskRunCommandPayload,
  mapTaskStatusCommandPayload,
  mapTaskUpdateCommandPayload,
} from "./TaskActionInput.js";
import type { TaskExecutionCoordinator } from "./TaskExecutionCoordinator.js";
import type { TaskDefinitionRepository } from "./TaskDefinitionRepository.js";
import type { TaskCompletionDeliveryPort } from "@/task/types/TaskRunner.js";

const TASK_STATUS_SCHEMA = z.enum(["enabled", "paused"]);
const TASK_KIND_SCHEMA = z.enum(["user", "agent", "script"]);

const TASK_LIST_SCHEMA = z.object({
  status: TASK_STATUS_SCHEMA.optional(),
});

const TASK_CREATE_SCHEMA = z.object({
  title: z.string(),
  when: z.string().default("@manual"),
  workspace_id: z.string().optional(),
  kind: TASK_KIND_SCHEMA.optional(),
  review: z.boolean().optional(),
  schedule: TASK_STATUS_SCHEMA.optional(),
  body: z.string().optional(),
});

const TASK_UPDATE_SCHEMA = z.object({
  title: z.string(),
  titleNext: z.string().optional(),
  when: z.string().optional(),
  clearWhen: z.boolean().optional(),
  workspace_id: z.string().optional(),
  kind: TASK_KIND_SCHEMA.optional(),
  review: z.boolean().optional(),
  schedule: TASK_STATUS_SCHEMA.optional(),
  body: z.string().optional(),
  clearBody: z.boolean().optional(),
});

const TASK_RUN_SCHEMA = z.object({
  title: z.string(),
  reason: z.string().optional(),
  scheduler_trigger: z.enum(["cron", "time"]).optional(),
  expected_when: z.string().optional(),
  occurrence_id: z.string().optional(),
});

const TASK_HISTORY_SCHEMA = z.object({
  title: z.string(),
});

const TASK_RUN_DETAIL_SCHEMA = z.object({
  title: z.string(),
  timestamp: z.string().regex(/^\d{8}-\d{6}-\d{3}$/u),
});

const TASK_DELETE_SCHEMA = z.object({
  title: z.string(),
});

const TASK_STATUS_REQ_SCHEMA = z.object({
  title: z.string(),
  status: TASK_STATUS_SCHEMA,
});

/**
 * 创建 task power runtime 的 action 定义表。
 */
export function createTaskPowerActions(params: {
  /** 读取 TaskPower initialize 后由 City 绑定的通知端口。 */
  resolve_notifications: () => PowerNotificationPublisher;
  /** 读取 TaskPower 生命周期级统一存储。 */
  resolve_storage: () => PowerStorage;
  /** 读取 TaskPower 唯一的定义事务入口。 */
  resolve_definitions: () => TaskDefinitionRepository;
  /** TaskPower 实例级执行协调器。 */
  executions: TaskExecutionCoordinator;
  /** 读取 City 提供的跨 Agent Session 交付端口。 */
  resolve_delivery: () => TaskCompletionDeliveryPort;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}): PowerActions {
  return {
    list: create_action({
      description: "List task definitions, optionally filtered by status.",
      returns: "tasks(task_id, title, body, when, kind, schedule, agent_id, workspace_id, workflow)",
      access: "read",
      input_schema: {
        zod: TASK_LIST_SCHEMA,
        json_schema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["enabled", "paused"],
              description: "Filter by schedule status.",
            },
          },
        },
      },
      examples: [
        { title: "All tasks", payload: {} },
        { title: "Enabled only", payload: { status: "enabled" } },
      ],
      command: {
        description: "List tasks.",
        configure(command: Command) {
          command.option(
            "--status <status>",
            "Filter by schedule status (enabled|paused).",
          );
        },
        map_input: mapTaskListCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskListAction({
          context: actionParams.context,
          storage: params.resolve_storage(),
          payload: actionParams.input as TaskListActionPayload,
        });
      },
    }),
    history: create_action({
      description: "List persisted execution records for one task.",
      returns: "runs(timestamp, status, started_at, finished_at, summary)",
      access: "read",
      input_schema: {
        zod: TASK_HISTORY_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", description: "Task name." },
          },
        },
      },
      examples: [{ title: "Read execution history", payload: { title: "daily-report" } }],
      execute: async (action_params) => execute_task_history_action({
        context: action_params.context,
        storage: params.resolve_storage(),
        payload: action_params.input as unknown as TaskRunHistoryRequest,
      }),
    }),
    run_detail: create_action({
      description: "Read one persisted task execution and its user-visible artifacts.",
      returns: "run(timestamp, status, input, output, result, error, artifacts)",
      access: "read",
      input_schema: {
        zod: TASK_RUN_DETAIL_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title", "timestamp"],
          properties: {
            title: { type: "string", description: "Task name." },
            timestamp: { type: "string", description: "Run timestamp returned by task.history." },
          },
        },
      },
      examples: [{ title: "Read one execution", payload: { title: "daily-report", timestamp: "20260901-080000-000" } }],
      execute: async (action_params) => execute_task_run_detail_action({
        context: action_params.context,
        storage: params.resolve_storage(),
        payload: action_params.input as unknown as TaskRunDetailRequest,
      }),
    }),
    create: create_action({
      description: "Validate and save structured task fields directly, without an internal model or another confirmation. Prefer this when fields are already known. Timed rules activate unless paused; manual work waits for run.",
      returns: "task_id, title, scheduler",
      access: "write",
      input_schema: {
        zod: TASK_CREATE_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", description: "Editable task title; duplicate titles create separate tasks." },
            when: { type: "string", description: "Trigger (@manual | cron | time:ISO8601-with-timezone); one-time triggers must be in the future." },
            workspace_id: { type: "string", description: "Execution Workspace. Defaults to the current action Workspace." },
            kind: { type: "string", enum: ["user", "agent", "script"], description: "user is a personal todo/reminder; agent and script execute in a Workspace." },
            review: { type: "boolean", description: "Whether to enable multi-turn review." },
            schedule: { type: "string", enum: ["enabled", "paused"], description: "Schedule status; paused keeps the rule but stops automatic triggers." },
            body: { type: "string", description: "Execution instructions; required for agent and script." },
          },
        },
      },
      examples: [
        {
          title: "Create a manual task",
          payload: {
            title: "daily-report",
            when: "@manual",
            body: "Generate a daily report",
            workspace_id: "workspace-1",
            schedule: "enabled",
          },
        },
      ],
      command: {
        description: "Create a task definition.",
        configure(command: Command) {
          command
            .requiredOption("--title <title>", "Editable task title.")
            .option("--when <when>", "Trigger condition (@manual | cron | time:ISO8601).", "@manual")
            .option("--kind <kind>", "Execution kind (user|agent|script).", "agent")
            .option("--review <review>", "Whether to enable multi-turn review (true|false).")
            .option("--workspace-id <workspace_id>", "Execution Workspace. Defaults to the current Workspace.")
            .option(
              "--schedule <schedule>",
              "Schedule status (enabled|paused, default enabled).",
            )
            .option(
              "--activate",
              "Enable immediately after creation (same as --schedule enabled).",
              false,
            )
            .option("--body <body>", "Task body.");
        },
        map_input: mapTaskCreateCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskCreateAction({
          context: actionParams.context,
          definitions: params.resolve_definitions(),
          payload: actionParams.input as TaskCreateRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    run: create_action({
      description: "Run a task manually.",
      returns: "accepted, message, execution_id",
      access: "write",
      input_schema: {
        zod: TASK_RUN_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", description: "Task name." },
            reason: { type: "string", description: "Reason for manual run." },
            occurrence_id: { type: "string", description: "Retry this recurring occurrence without creating another planned item." },
          },
        },
      },
      examples: [{ title: "Manual run", payload: { title: "daily-report" } }],
      command: {
        description: "Run a task manually.",
        configure(command: Command) {
          command
            .argument("<title>")
            .option("--reason <reason>", "Reason for manual run.");
        },
        map_input: mapTaskRunCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskRunAction({
          context: actionParams.context,
          definitions: params.resolve_definitions(),
          payload: actionParams.input as TaskRunRequest,
          executions: params.executions,
          notifications: params.resolve_notifications(),
          execution_context: actionParams.context.snapshot,
          delivery: params.resolve_delivery(),
        });
      },
    }),
    delete: create_action({
      description: "Delete a task definition and historical run directories.",
      returns: "title, deleted, removed_run_count",
      access: "write",
      input_schema: {
        zod: TASK_DELETE_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", description: "Task name." },
          },
        },
      },
      examples: [{ title: "Delete task", payload: { title: "daily-report" } }],
      command: {
        description: "Delete a task definition and historical run directories.",
        configure(command: Command) {
          command.argument("<title>");
        },
        map_input: mapTaskDeleteCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskDeleteAction({
          context: actionParams.context,
          definitions: params.resolve_definitions(),
          payload: actionParams.input as TaskDeleteRequest,
          notifications: params.resolve_notifications(),
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    update: create_action({
      description: "Update a task definition.",
      returns: "title, schedule, when, kind, definition_path",
      access: "write",
      input_schema: {
        zod: TASK_UPDATE_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", description: "Current task name." },
            titleNext: { type: "string", description: "New task name." },
            when: { type: "string", description: "New trigger condition." },
            clearWhen: { type: "boolean", description: "Whether to clear the trigger condition." },
            workspace_id: { type: "string", description: "New execution Workspace." },
            kind: { type: "string", enum: ["user", "agent", "script"] },
            review: { type: "boolean" },
            schedule: { type: "string", enum: ["enabled", "paused"] },
            body: { type: "string", description: "New execution instructions." },
            clearBody: { type: "boolean", description: "Whether to clear the body." },
          },
        },
      },
      examples: [
        {
          title: "Update trigger",
          payload: { title: "daily-report", when: "cron:0 9 * * *" },
        },
      ],
      command: {
        description: "Update a task definition.",
        configure(command: Command) {
          command
            .argument("<title>")
            .option("--title <title>", "Task name while preserving the same semantics.")
            .option("--when <when>", "Trigger condition (@manual | cron | time:ISO8601).")
            .option("--kind <kind>", "Execution kind (user|agent|script).")
            .option("--review <review>", "Whether to enable multi-turn review (true|false).")
            .option("--clear-when", "Clear when and fall back to @manual.", false)
            .option("--workspace-id <workspace_id>", "Execution Workspace.")
            .option("--schedule <schedule>", "Schedule status (enabled|paused).")
            .option(
              "--activate",
              "Enable immediately after update (same as --schedule enabled).",
              false,
            )
            .option("--body <body>", "Set task body.")
            .option("--clear-body", "Clear task body.", false);
        },
        map_input: mapTaskUpdateCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskUpdateAction({
          context: actionParams.context,
          definitions: params.resolve_definitions(),
          payload: actionParams.input as TaskUpdateRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    status: create_action({
      description: "Set schedule status (enabled|paused).",
      returns: "title, schedule",
      access: "write",
      input_schema: {
        zod: TASK_STATUS_REQ_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title", "status"],
          properties: {
            title: { type: "string", description: "Task name." },
            status: { type: "string", enum: ["enabled", "paused"] },
          },
        },
      },
      examples: [
        { title: "Pause task", payload: { title: "daily-report", status: "paused" } },
      ],
      command: {
        description: "Set schedule status (enabled|paused).",
        configure(command: Command) {
          command.argument("<title>").argument("<status>");
        },
        map_input: mapTaskStatusCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskStatusAction({
          context: actionParams.context,
          definitions: params.resolve_definitions(),
          payload: actionParams.input as TaskSetStatusRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    enable: create_action({
      description: "Enable a task (status=enabled).",
      returns: "title, status",
      access: "write",
      input_schema: {
        zod: z.object({ title: z.string() }),
        json_schema: {
          type: "object",
          required: ["title"],
          properties: { title: { type: "string", description: "Task name." } },
        },
      },
      examples: [{ title: "Enable", payload: { title: "daily-report" } }],
      command: {
        description: "Enable a task (status=enabled).",
        configure(command: Command) {
          command.argument("<title>");
        },
        map_input: mapTaskEnableCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskStatusAction({
          context: actionParams.context,
          definitions: params.resolve_definitions(),
          payload: actionParams.input as TaskSetStatusRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    disable: create_action({
      description: "Disable a task (status=disabled).",
      returns: "title, status",
      access: "write",
      input_schema: {
        zod: z.object({ title: z.string() }),
        json_schema: {
          type: "object",
          required: ["title"],
          properties: { title: { type: "string", description: "Task name." } },
        },
      },
      examples: [{ title: "Disable", payload: { title: "daily-report" } }],
      command: {
        description: "Disable a task (status=disabled).",
        configure(command: Command) {
          command.argument("<title>");
        },
        map_input: mapTaskDisableCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskStatusAction({
          context: actionParams.context,
          definitions: params.resolve_definitions(),
          payload: actionParams.input as TaskSetStatusRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
  };
}

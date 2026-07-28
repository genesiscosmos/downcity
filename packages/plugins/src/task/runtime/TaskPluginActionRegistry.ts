/**
 * TaskPluginActions：task plugin runtime 的 action 注册表模块。
 *
 * 关键点（中文）
 * - 这里专门负责把 task 的 CLI/execute 定义装配成 `PluginActions`。
 * - task plugin runtime 本体只保留实例状态与 lifecycle，不再承载大段 action 声明。
 */

import type { Command } from "commander";
import type { PluginActions } from "@downcity/agent";
import { create_action } from "@downcity/agent";
import { z } from "zod";
import type { TaskListActionPayload } from "@/task/types/TaskPluginTypes.js";
import type {
  TaskCreateRequest,
  TaskDeleteRequest,
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

const TASK_STATUS_SCHEMA = z.enum(["enabled", "paused", "disabled"]);
const TASK_KIND_SCHEMA = z.enum(["agent", "script"]);

const TASK_LIST_SCHEMA = z.object({
  status: TASK_STATUS_SCHEMA.optional(),
});

const TASK_CREATE_SCHEMA = z.object({
  title: z.string(),
  when: z.string(),
  description: z.string(),
  session_id: z.string(),
  kind: TASK_KIND_SCHEMA.optional(),
  review: z.boolean().optional(),
  status: TASK_STATUS_SCHEMA.optional(),
  body: z.string().optional(),
  overwrite: z.boolean().optional(),
});

const TASK_UPDATE_SCHEMA = z.object({
  title: z.string(),
  titleNext: z.string().optional(),
  when: z.string().optional(),
  clearWhen: z.boolean().optional(),
  description: z.string().optional(),
  session_id: z.string().optional(),
  kind: TASK_KIND_SCHEMA.optional(),
  review: z.boolean().optional(),
  status: TASK_STATUS_SCHEMA.optional(),
  body: z.string().optional(),
  clearBody: z.boolean().optional(),
});

const TASK_RUN_SCHEMA = z.object({
  title: z.string(),
  reason: z.string().optional(),
});

const TASK_DELETE_SCHEMA = z.object({
  title: z.string(),
});

const TASK_STATUS_REQ_SCHEMA = z.object({
  title: z.string(),
  status: TASK_STATUS_SCHEMA,
});

/**
 * 创建 task plugin runtime 的 action 定义表。
 */
export function createTaskPluginActions(params: {
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}): PluginActions {
  return {
    list: create_action({
      description: "List task definitions, optionally filtered by status.",
      input_schema: {
        zod: TASK_LIST_SCHEMA,
        json_schema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["enabled", "paused", "disabled"],
              description: "Filter by task status.",
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
            "Filter by status (enabled|paused|disabled).",
          );
        },
        map_input: mapTaskListCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskListAction({
          context: actionParams.context,
          payload: actionParams.input as TaskListActionPayload,
        });
      },
    }),
    create: create_action({
      description: "Create a task definition.",
      input_schema: {
        zod: TASK_CREATE_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title", "when", "description", "session_id"],
          properties: {
            title: { type: "string", description: "Task name and unique semantic identifier." },
            when: { type: "string", description: "Trigger condition (@manual | cron | time:ISO8601)." },
            description: { type: "string", description: "Task description." },
            session_id: { type: "string", description: "Task execution session_id." },
            kind: { type: "string", enum: ["agent", "script"], description: "Execution kind." },
            review: { type: "boolean", description: "Whether to enable multi-turn review." },
            status: { type: "string", enum: ["enabled", "paused", "disabled"], description: "Task status." },
            body: { type: "string", description: "Task body." },
            overwrite: { type: "boolean", description: "Whether to overwrite an existing task.md." },
          },
        },
      },
      examples: [
        {
          title: "Create a manual task",
          payload: {
            title: "daily-report",
            when: "@manual",
            description: "Generate a daily report",
            session_id: "session-1",
            status: "enabled",
          },
        },
      ],
      command: {
        description: "Create a task definition.",
        configure(command: Command) {
          command
            .requiredOption("--title <title>", "Task name and unique semantic identifier.")
            .requiredOption("--description <description>", "Task description.")
            .option("--when <when>", "Trigger condition (@manual | cron | time:ISO8601).", "@manual")
            .option("--kind <kind>", "Execution kind (agent|script).", "agent")
            .option("--review <review>", "Whether to enable multi-turn review (true|false).")
            .option(
              "--session-id <session_id>",
              "Task execution session_id. If omitted, DC_SESSION_ID is used when available.",
            )
            .option(
              "--status <status>",
              "Status (enabled|paused|disabled, default enabled).",
            )
            .option(
              "--activate",
              "Enable immediately after creation (same as --status enabled).",
              false,
            )
            .option("--body <body>", "Task body.")
            .option("--overwrite", "Overwrite an existing task.md.", false);
        },
        map_input: mapTaskCreateCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskCreateAction({
          context: actionParams.context,
          payload: actionParams.input as TaskCreateRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    run: create_action({
      description: "Run a task manually.",
      input_schema: {
        zod: TASK_RUN_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", description: "Task name." },
            reason: { type: "string", description: "Reason for manual run." },
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
          payload: actionParams.input as TaskRunRequest,
          execution_context: actionParams.execution_context,
        });
      },
    }),
    delete: create_action({
      description: "Delete a task definition and historical run directories.",
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
          payload: actionParams.input as TaskDeleteRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    update: create_action({
      description: "Update a task definition.",
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
            description: { type: "string", description: "New description." },
            session_id: { type: "string", description: "New session_id." },
            kind: { type: "string", enum: ["agent", "script"] },
            review: { type: "boolean" },
            status: { type: "string", enum: ["enabled", "paused", "disabled"] },
            body: { type: "string", description: "New body." },
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
            .option("--description <description>", "Task description.")
            .option("--when <when>", "Trigger condition (@manual | cron | time:ISO8601).")
            .option("--kind <kind>", "Execution kind (agent|script).")
            .option("--review <review>", "Whether to enable multi-turn review (true|false).")
            .option("--clear-when", "Clear when and fall back to @manual.", false)
            .option("--session-id <session_id>", "Task execution session_id.")
            .option("--status <status>", "Status (enabled|paused|disabled).")
            .option(
              "--activate",
              "Enable immediately after update (same as --status enabled).",
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
          payload: actionParams.input as TaskUpdateRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    status: create_action({
      description: "Set task status (enabled|paused|disabled).",
      input_schema: {
        zod: TASK_STATUS_REQ_SCHEMA,
        json_schema: {
          type: "object",
          required: ["title", "status"],
          properties: {
            title: { type: "string", description: "Task name." },
            status: { type: "string", enum: ["enabled", "paused", "disabled"] },
          },
        },
      },
      examples: [
        { title: "Pause task", payload: { title: "daily-report", status: "paused" } },
      ],
      command: {
        description: "Set task status (enabled|paused|disabled).",
        configure(command: Command) {
          command.argument("<title>").argument("<status>");
        },
        map_input: mapTaskStatusCommandPayload,
      },
      execute: async (actionParams) => {
        return executeTaskStatusAction({
          context: actionParams.context,
          payload: actionParams.input as TaskSetStatusRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    enable: create_action({
      description: "Enable a task (status=enabled).",
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
          payload: actionParams.input as TaskSetStatusRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
    disable: create_action({
      description: "Disable a task (status=disabled).",
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
          payload: actionParams.input as TaskSetStatusRequest,
          reloadSchedulerAfterMutation: params.reloadSchedulerAfterMutation,
        });
      },
    }),
  };
}

/**
 * @file 验证 plugin tool bridge 会把生成文件摘要为可打开路径。
 *
 * 关键点（中文）
 * - assistant message 使用 Agent 根目录相对路径，避免历史暴露本机路径。
 * - tool result 同时返回相对路径与本机绝对路径，便于模型与用户明确知道文件位置。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  invoke_plugin_call_tool,
  invoke_plugin_read_tool,
} from "../bin/executor/tools/plugin/PluginToolBridge.js";
import { create_plugin_tools } from "../bin/executor/tools/plugin/PluginToolDefinition.js";
import { plugin_call_input_schema } from "../bin/executor/tools/plugin/PluginToolSchemas.js";
import { create_action, create_plugin } from "../bin/plugin/core/PluginActionFactory.js";
import { PluginRegistry } from "../bin/plugin/core/PluginRegistry.js";
import { create_session_turn_context } from "../bin/session/runtime/SessionTurnContext.js";
import { z } from "zod";

function create_turn_context(project_root) {
  return create_session_turn_context({
    session_id: "session_test",
    turn_id: "turn_test",
    project_root: project_root,
  });
}

function create_registry(plugin) {
  const registry = new PluginRegistry([plugin]);
  registry.bind_context({ workspace_path: process.cwd() });
  return registry;
}

test("plugin_call payload schema allows arbitrary object properties", async () => {
  const plugin_call_schema = await plugin_call_input_schema.jsonSchema;
  const payload_schema = plugin_call_schema.properties.payload;

  assert.equal(plugin_call_schema.type, "object");
  assert.deepEqual(plugin_call_schema.required, ["plugin", "action"]);
  assert.equal(plugin_call_schema.additionalProperties, false);
  assert.equal(payload_schema.type, "object");
  assert.equal(payload_schema.additionalProperties, true);
  assert.deepEqual(payload_schema.default, {});
});

test("invoke_plugin_call_tool returns absolute paths for materialized file parts", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-plugin-tool-files-"),
  );
  const bytes = Buffer.from("png-bytes-for-plugin-tool", "utf8");

  const plugins = {
    list: () => [],
    read: () => ({ plugins: [] }),
    availability: async () => ({ enabled: true, available: true, reasons: [] }),
    run_action: async () => ({
      success: true,
      message: "image generated",
      data: {
        id: "msg_image_test",
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "image.png",
            url: `data:image/png;base64,${bytes.toString("base64")}`,
          },
        ],
      },
    }),
    pipeline: async (_, value) => value,
    guard: async () => {},
    effect: async () => {},
    resolve: async () => {
      throw new Error("not implemented");
    },
  };

  const turn_context = create_turn_context(project_root);
  const result = await invoke_plugin_call_tool({
    plugins,
    turn_context,
    input: {
      plugin: "image",
      action: "image_result",
      payload: { job_id: "img_1" },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.assistant_file_count, 1);
  assert.equal(result.files?.length, 1);
  assert.match(result.files[0].relative_path, /^\.downcity\/resources\//);
  assert.equal(path.isAbsolute(result.files[0].path), true);
  assert.equal(
    path.dirname(result.files[0].path),
    path.join(project_root, ".downcity", "resources"),
  );
  assert.deepEqual(await fs.readFile(result.files[0].path), bytes);
  assert.equal("data" in result, false);

  const pending_parts = turn_context.output.assistant_file_parts();
  assert.equal(pending_parts.length, 1);
  assert.equal(pending_parts[0].url, result.files[0].relative_path);
});

test("invoke_plugin_read_tool returns plugin action metadata", async () => {
  const plugins = {
    list: () => [],
    read: () => ({
      name: "image",
      title: "Image",
      description: "Create images",
      actions: [
        {
          name: "image_create",
          description: "Create image job",
          has_input_schema: true,
          input_schema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
            },
          },
          examples: [
            {
              title: "Text-only image",
              payload: { prompt: "draw" },
            },
          ],
          has_command: false,
          has_api: false,
        },
      ],
    }),
    availability: async () => ({ enabled: true, available: true, reasons: [] }),
    run_action: async () => ({ success: false, error: "not used" }),
    pipeline: async (_, value) => value,
    guard: async () => {},
    effect: async () => {},
    resolve: async () => {
      throw new Error("not implemented");
    },
  };

  const result = await invoke_plugin_read_tool({
    plugins,
    turn_context: create_turn_context(process.cwd()),
    input: {
      plugin: "image",
      action: "image_create",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.name, "image");
  assert.equal(result.data.actions[0].name, "image_create");
  assert.equal(result.data.actions[0].has_input_schema, true);
  assert.equal(result.data.actions[0].examples[0].payload.prompt, "draw");
});

test("invoke_plugin_read_tool rejects unregistered plugins", async () => {
  const registry = create_registry(
    create_plugin({
      name: "skill",
      title: "Skill",
      description: "Manage skills",
      actions: {},
    }),
  );

  const result = await invoke_plugin_read_tool({
    plugins: registry,
    turn_context: create_turn_context(process.cwd()),
    input: { plugin: "task" },
  });

  assert.equal(result.success, false);
  assert.match(result.message, /Unknown plugin: task/);
  assert.match(result.data.error, /Unknown plugin: task/);
});

test("invoke_plugin_read_tool rejects unknown plugin actions", async () => {
  const registry = create_registry(
    create_plugin({
      name: "skill",
      title: "Skill",
      description: "Manage skills",
      actions: {},
    }),
  );

  const result = await invoke_plugin_read_tool({
    plugins: registry,
    turn_context: create_turn_context(process.cwd()),
    input: { plugin: "skill", action: "missing" },
  });

  assert.equal(result.success, false);
  assert.match(result.message, /Unknown action: skill\.missing/);
  assert.match(result.data.error, /Unknown action: skill\.missing/);
});

test("PluginRegistry validates action payload with metadata schema", async () => {
  const plugin = create_plugin({
    name: "demo",
    title: "Demo",
    description: "Demo plugin",
    actions: {
      echo: create_action({
        description: "Echo text",
        input_schema: {
          zod: z.object({
            text: z.string(),
          }),
          json_schema: {
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string" },
            },
          },
        },
        execute: async ({ input }) => ({
          success: true,
          data: { text: input.text },
          message: "echoed",
        }),
      }),
    },
  });
  const registry = create_registry(plugin);

  const metadata = registry.read({ plugin: "demo", action: "echo" });
  assert.equal(metadata.actions[0].description, "Echo text");
  assert.equal(metadata.actions[0].has_input_schema, true);

  const invalid = await registry.run_action({
    plugin: "demo",
    action: "echo",
    payload: {},
  });
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /Invalid payload/);

  const valid = await registry.run_action({
    plugin: "demo",
    action: "echo",
    payload: { text: "hello" },
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data.text, "hello");
});

test("create_plugin_tools binds plugin_call to the current registry", async () => {
  function create_owner_registry(owner) {
    const plugin = create_plugin({
      name: "skill",
      title: `Skill ${owner}`,
      description: "Owner scoped skill plugin",
      actions: {
        lookup: create_action({
          description: "Return registry owner",
          execute: async ({ execution_context }) => ({
            success: true,
            data: {
              owner,
              session_id: execution_context?.session_id,
              context_keys: Object.keys(execution_context || {}).sort(),
            },
            message: owner,
          }),
        }),
      },
    });
    return create_registry(plugin);
  }

  const registry_a = create_owner_registry("agent_a");
  const registry_b = create_owner_registry("agent_b");
  const tools_a = create_plugin_tools({ plugins: registry_a });
  const tools_b = create_plugin_tools({ plugins: registry_b });
  const create_execution_options = (session_id) => {
    const turn_context = create_session_turn_context({
      session_id,
      turn_id: `turn_${session_id}`,
      project_root: process.cwd(),
    });
    return {
      toolCallId: `call_${session_id}`,
      messages: [],
      experimental_context: {
        session_turn_context: turn_context,
        shell_run_context: {
          ownerContextId: session_id,
        },
      },
    };
  };

  const result_a = await tools_a.plugin_call.execute({
    plugin: "skill",
    action: "lookup",
    payload: { name: "anything" },
  }, create_execution_options("session_a"));
  const result_b = await tools_b.plugin_call.execute({
    plugin: "skill",
    action: "lookup",
    payload: { name: "anything" },
  }, create_execution_options("session_b"));

  assert.equal(result_a.success, true);
  assert.equal(result_a.data.value.owner, "agent_a");
  assert.equal(result_a.data.value.session_id, "session_a");
  assert.deepEqual(result_a.data.value.context_keys, [
    "abort_signal",
    "agent_systems",
    "project_root",
    "session_id",
    "turn_id",
  ]);
  assert.equal(result_b.success, true);
  assert.equal(result_b.data.value.owner, "agent_b");
  assert.equal(result_b.data.value.session_id, "session_b");
});

test("PluginRegistry keeps plugin ready after action business failure", async () => {
  let call_count = 0;
  const plugin = create_plugin({
    name: "skill",
    title: "Skill",
    description: "Retryable skill plugin",
    actions: {
      lookup: create_action({
        description: "Fail once then succeed",
        execute: async () => {
          call_count += 1;
          if (call_count === 1) {
            return {
              success: false,
              error: "Skill not found: missing",
              message: "Skill not found: missing",
            };
          }
          return {
            success: true,
            data: { loaded: true },
            message: "loaded",
          };
        },
      }),
    },
  });
  const registry = create_registry(plugin);

  const failed = await registry.run_action({
    plugin: "skill",
    action: "lookup",
    payload: { name: "missing" },
  });
  assert.equal(failed.success, false);
  assert.equal(registry.status("skill").status, "ready");

  const retry = await registry.run_action({
    plugin: "skill",
    action: "lookup",
    payload: { name: "exists" },
  });
  assert.equal(retry.success, true);
  assert.equal(retry.data.loaded, true);
  assert.equal(registry.status("skill").status, "ready");
});

test("PluginRegistry delays lifecycle stop until the active execution lease is released", async () => {
  let lifecycle_active = false;
  let stop_count = 0;
  const plugin = create_plugin({
    name: "leased-plugin",
    title: "Leased Plugin",
    description: "Keeps runtime resources alive for an active Session step",
    lifecycle: {
      start: async () => {
        lifecycle_active = true;
      },
      stop: async () => {
        lifecycle_active = false;
        stop_count += 1;
      },
    },
    actions: {
      status: create_action({
        description: "Read lifecycle state",
        execute: async () => ({
          success: lifecycle_active,
          data: { lifecycle_active },
        }),
      }),
    },
  });
  const registry = create_registry(plugin);
  await registry.start_all();
  const lease = registry.execution_view().acquire();

  assert.equal(await registry.unregister("leased-plugin"), true);
  assert.equal(registry.has("leased-plugin"), false);
  assert.equal(lifecycle_active, true);
  assert.equal(stop_count, 0);

  const result = await lease.run_action({
    plugin: "leased-plugin",
    action: "status",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.lifecycle_active, true);

  await lease.release();
  await lease.release();
  assert.equal(lifecycle_active, false);
  assert.equal(stop_count, 1);
});

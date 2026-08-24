/**
 * @file 验证 Plugin Tool 的 ActionResult 转换与 Agent 绑定。
 *
 * 关键点（中文）
 * - Plugin Action 自己产生本地 File Part，Tool 运行时不处理文件。
 * - output 与 messages 分开返回，由 Executor 的统一边界分流。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  invoke_plugin_call_tool,
  invoke_plugin_read_tool,
} from "../bin/plugin/tool/PluginToolRuntime.js";
import { create_plugin_tools } from "../bin/plugin/tool/PluginTools.js";
import { plugin_call_input_schema } from "../bin/plugin/tool/PluginToolSchemas.js";
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
  const registry = new PluginRegistry({
    agent_id: "plugin_tools_agent",
    instructions: [],
  }, [plugin]);
  const context = {
    agent_id: "plugin_tools_agent",
    workspace_id: "plugin_tools_workspace",
    workspace_path: process.cwd(),
  };
  return Object.assign(registry.contextual(context), {
    execution_view: () => registry.execution_view(context),
  });
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

test("invoke_plugin_call_tool preserves Action output and messages", async () => {
  const plugins = {
    list: () => [],
    read: () => ({ plugins: [] }),
    availability: async () => ({ enabled: true, available: true, reasons: [] }),
    run_action: async () => ({
      success: true,
      message: "image generated",
      data: { job_id: "img_1" },
      messages: [{
        role: "assistant",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "image.png",
            url: "/workspace/image.png",
          },
        ],
      }],
    }),
    pipeline: async (_, value) => value,
    guard: async () => {},
    effect: async () => {},
    resolve: async () => {
      throw new Error("not implemented");
    },
  };

  const turn_context = create_turn_context("/workspace");
  const result = await invoke_plugin_call_tool({
    plugins,
    turn_context,
    call_id: "call_image_result",
    input: {
      plugin: "image",
      action: "image_result",
      payload: { job_id: "img_1" },
    },
  });

  assert.deepEqual(result.output, {
    success: true,
    plugin: "image",
    action: "image_result",
    message: "image generated",
    data: { job_id: "img_1" },
  });
  assert.deepEqual(result.messages, [{
    role: "assistant",
    parts: [{
      type: "file",
      mediaType: "image/png",
      filename: "image.png",
      url: "/workspace/image.png",
    }],
  }]);
  assert.equal(turn_context.output.take_assistant_parts().length, 0);
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

  assert.equal(result.output.success, true);
  assert.equal(result.output.data.name, "image");
  assert.equal(result.output.data.actions[0].name, "image_create");
  assert.equal(result.output.data.actions[0].has_input_schema, true);
  assert.equal(result.output.data.actions[0].examples[0].payload.prompt, "draw");
  assert.deepEqual(result.messages, []);
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

  assert.equal(result.output.success, false);
  assert.match(result.output.message, /Unknown plugin: task/);
  assert.match(result.output.data.error, /Unknown plugin: task/);
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

  assert.equal(result.output.success, false);
  assert.match(result.output.message, /Unknown action: skill\.missing/);
  assert.match(result.output.data.error, /Unknown action: skill\.missing/);
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
          execute: async ({ execution }) => ({
            success: true,
            data: {
              owner,
              session_id: execution.session?.session_id,
              call_id: execution.call_id,
              has_interactions: Boolean(execution.session?.interactions),
              context_keys: Object.keys(execution).sort(),
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
      interactions: {
        request: async () => {
          throw new Error("interaction request is not expected in this test");
        },
      },
    });
    return {
      toolCallId: `call_${session_id}`,
      messages: [],
      experimental_context: {
        session_turn_context: turn_context,
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

  assert.equal(result_a.output.success, true);
  assert.equal(result_a.output.data.owner, "agent_a");
  assert.equal(result_a.output.data.session_id, "session_a");
  assert.equal(result_a.output.data.call_id, "call_session_a");
  assert.equal(result_a.output.data.has_interactions, true);
  assert.deepEqual(result_a.output.data.context_keys, [
    "abort_signal",
    "call_id",
    "session",
    "snapshot",
  ]);
  assert.equal(result_b.output.success, true);
  assert.equal(result_b.output.data.owner, "agent_b");
  assert.equal(result_b.output.data.session_id, "session_b");
  assert.equal(result_b.output.data.call_id, "call_session_b");
  assert.equal(result_b.output.data.has_interactions, true);
});

test("PluginRegistry keeps Session identity when no Interaction port is provided", async () => {
  let observed_execution;
  const plugin = create_plugin({
    name: "session_identity",
    actions: {
      inspect: create_action({
        execute: async ({ execution }) => {
          observed_execution = execution;
          return { success: true };
        },
      }),
    },
  });
  const plugins = create_registry(plugin);

  const result = await plugins.run_action({
    plugin: "session_identity",
    action: "inspect",
    execution_context: {
      session_id: "session_without_interactions",
      turn_id: "turn_without_interactions",
    },
  });

  assert.equal(result.success, true);
  assert.equal(observed_execution.session.session_id, "session_without_interactions");
  assert.equal(observed_execution.session.turn_id, "turn_without_interactions");
  assert.equal(observed_execution.session.interactions, undefined);
});

test("PluginRegistry separates stable context from non-Session action execution", async () => {
  let observed_context;
  let observed_execution;
  const plugin = create_plugin({
    name: "identity",
    actions: {
      inspect: create_action({
        execute: async ({ context, execution }) => {
          observed_context = context;
          observed_execution = execution;
          return { success: true };
        },
      }),
    },
  });
  const plugins = create_registry(plugin);

  const result = await plugins.run_action({
    plugin: "identity",
    action: "inspect",
  });

  assert.equal(result.success, true);
  assert.equal(observed_context.agent_id, "plugin_tools_agent");
  assert.equal(observed_context.workspace_id, "plugin_tools_workspace");
  assert.match(observed_execution.call_id, /^plugin:/);
  assert.equal(observed_execution.abort_signal.aborted, false);
  assert.equal(Object.isFrozen(observed_execution), true);
  assert.equal(observed_execution.session, undefined);
});

test("PluginRegistry rejects an action before execution when the caller is cancelled", async () => {
  let executed = false;
  const plugin = create_plugin({
    name: "cancelled",
    actions: {
      run: create_action({
        execute: async () => {
          executed = true;
          return { success: true };
        },
      }),
    },
  });
  const plugins = create_registry(plugin);
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));

  const result = await plugins.run_action({
    plugin: "cancelled",
    action: "run",
    execution_context: {
      call_id: "call_cancelled",
      abort_signal: controller.signal,
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "caller cancelled");
  assert.equal(executed, false);
});

test("PluginRegistry applies the action cooperative timeout to abort_signal", async () => {
  const plugin = create_plugin({
    name: "timeout",
    actions: {
      wait: create_action({
        timeout_ms: 10,
        execute: async ({ execution }) => {
          await new Promise((resolve) => {
            execution.abort_signal.addEventListener("abort", resolve, { once: true });
          });
          return { success: true };
        },
      }),
    },
  });
  const plugins = create_registry(plugin);

  const result = await plugins.run_action({
    plugin: "timeout",
    action: "wait",
  });

  assert.equal(result.success, false);
  assert.match(result.error, /timed out after 10 ms/);
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

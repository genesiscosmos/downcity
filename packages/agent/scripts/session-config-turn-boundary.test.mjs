/**
 * @file 验证 Agent 配置与 steer 在 Session step 检查点统一生效。
 *
 * 关键点（中文）
 * - 第一次 provider 请求保持阻塞，用来制造真实的运行中配置修改窗口。
 * - Agent instruction 与 plugin system 修改不能改变已有 Session；plugin action 视图在 step 检查点生效。
 * - config 与 steer 在同一个 Session step 检查点提交，并继续使用同一个 turn id。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { MockLanguageModelV3 } from "ai/test";
import { Agent, Workspace } from "../bin/index.js";
import {
  create_action,
  create_plugin,
} from "../bin/plugin/core/PluginActionFactory.js";

function create_deferred() {
  let resolve;
  const promise = new Promise((inner_resolve) => {
    resolve = inner_resolve;
  });
  return { promise, resolve };
}

function create_stream_text_result(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text_1" });
        controller.enqueue({ type: "text-delta", id: "text_1", delta: text });
        controller.enqueue({ type: "text-end", id: "text_1" });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: {
              total: 0,
              noCache: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: {
              total: 0,
              text: 0,
              reasoning: 0,
            },
          },
        });
        controller.close();
      },
    }),
  };
}

test("Agent instruction changes only affect newly created Sessions", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-config-turn-boundary-"),
  );
  const first_provider_request_started = create_deferred();
  const release_first_provider_request = create_deferred();
  const provider_prompts = [];
  let provider_request_count = 0;
  let plugin_stop_count = 0;

  const model = new MockLanguageModelV3({
    modelId: "config-turn-boundary-model",
    doStream: async (options) => {
      const has_tools = Array.isArray(options.tools) && options.tools.length > 0;
      if (!has_tools) return create_stream_text_result("Session title");
      provider_request_count += 1;
      provider_prompts.push(JSON.stringify(options.prompt));
      if (provider_request_count === 1) {
        first_provider_request_started.resolve();
        await release_first_provider_request.promise;
      }
      return create_stream_text_result(`done:${String(provider_request_count)}`);
    },
  });
  const runtime_plugin = create_plugin({
    name: "runtime-config",
    title: "Runtime Config",
    description: "Provides a system block for turn-boundary tests",
    lifecycle: {
      stop: async () => {
        plugin_stop_count += 1;
      },
    },
    system: (_context, execution_context) =>
      `plugin-env:${execution_context?.workspace_env?.TURN_ENV || "missing"}`,
    actions: {
      ping: create_action({
        description: "Ping",
        execute: async () => ({ success: true, data: { ok: true } }),
      }),
    },
  });
  const workspace = new Workspace({
    path: agent_path,
    env: { TURN_ENV: "old" },
  });
  const agent = new Agent({
    id: "config_turn_boundary_agent",
    workspace,
    model,
    instruction: ["instruction:old"],
    plugins: [runtime_plugin],
  });

  try {
    const session = await agent.sessions.create({
      session_id: "config_turn_boundary_session",
    });
    const first_turn = await session.prompt({ query: "first" });
    await first_provider_request_started.promise;

    agent.set_instruction(["instruction:new"]);
    workspace.patch_env({ TURN_ENV: "new" });
    await agent.plugins.unregister("runtime-config");
    const steer_turn_promise = session.prompt({ query: "steer" });

    assert.equal(plugin_stop_count, 0);
    assert.equal(provider_prompts.length, 1);
    assert.match(provider_prompts[0], /instruction:old/);
    assert.match(provider_prompts[0], /plugin-env:old/);
    assert.doesNotMatch(provider_prompts[0], /instruction:new/);

    release_first_provider_request.resolve();
    const steer_turn = await steer_turn_promise;
    assert.equal((await first_turn.finished).success, true);
    assert.equal(steer_turn.id, first_turn.id);
    assert.equal((await steer_turn.finished).success, true);
    assert.equal(plugin_stop_count, 1);
    assert.equal(provider_prompts.length, 2);
    assert.match(provider_prompts[1], /instruction:old/);
    assert.doesNotMatch(provider_prompts[1], /instruction:new/);
    assert.match(provider_prompts[1], /plugin-env:old/);

    const messages = await session.messages();
    const completed_actions = messages.items
      .filter((message) => message.type === "action" && message.status === "completed")
      .map((message) => message.title);
    assert.deepEqual(completed_actions, [
      "Workspace environment updated",
      "Agent plugin runtime-config unregistered",
    ]);

    // 未显式 snapshot 的 Session 重新装载时使用 Agent 当前 instruction。
    await agent.sessions.clear_messages(session.id);
    const restored_session = await agent.sessions.get(session.id);
    const restored_system = await restored_session.system();
    const restored_system_text = restored_system.blocks
      .map((block) => block.content)
      .join("\n");
    assert.match(restored_system_text, /instruction:new/);
    assert.doesNotMatch(restored_system_text, /instruction:old/);

    const new_session = await agent.sessions.create({
      session_id: "config_turn_boundary_new_session",
    });
    const new_system = await new_session.system();
    const new_system_text = new_system.blocks
      .map((block) => block.content)
      .join("\n");
    assert.match(new_system_text, /instruction:new/);
    assert.doesNotMatch(new_system_text, /instruction:old/);
  } finally {
    release_first_provider_request.resolve();
    await agent.dispose();
  }
});

test("Plugin registry changes do not rewrite an existing Session system", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-fixed-plugin-system-"),
  );
  const agent = new Agent({
    id: "fixed_plugin_system_agent",
    workspace: new Workspace({ path: agent_path }),
    model: new MockLanguageModelV3({ modelId: "fixed-plugin-system-model" }),
  });
  const runtime_plugin = create_plugin({
    name: "runtime-system",
    title: "Runtime System",
    description: "Provides a fixed Session system test block",
    system: () => "plugin-system:registered",
  });

  try {
    const existing_session = await agent.sessions.create({
      session_id: "existing_session",
    });
    const existing_before = await existing_session.system();

    await agent.plugins.register(runtime_plugin);
    const existing_after_register = await existing_session.system();
    assert.deepEqual(existing_after_register, existing_before);

    const registered_session = await agent.sessions.create({
      session_id: "registered_session",
    });
    const registered_before = await registered_session.system();
    assert.match(
      registered_before.blocks.map((block) => block.content).join("\n"),
      /plugin-system:registered/,
    );

    await agent.plugins.unregister("runtime-system");
    const registered_after_unregister = await registered_session.system();
    assert.deepEqual(registered_after_unregister, registered_before);

    const unregistered_session = await agent.sessions.create({
      session_id: "unregistered_session",
    });
    assert.doesNotMatch(
      (await unregistered_session.system()).blocks
        .map((block) => block.content)
        .join("\n"),
      /plugin-system:registered/,
    );
  } finally {
    await agent.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("Session syncshot refreshes system and only rewrites an existing instruction.md", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-syncshot-"),
  );
  const session_id = "syncshot_session";
  const instruction_path = path.join(
    agent_path,
    ".downcity",
    "agents",
    "syncshot_agent",
    "sessions",
    session_id,
    "instruction.md",
  );
  const create_system_plugin = (content) => create_plugin({
    name: "syncshot-system",
    title: "Syncshot System",
    description: "Provides system text refreshed by session.syncshot()",
    system: () => content,
  });
  const model = new MockLanguageModelV3({ modelId: "syncshot-model" });
  const agent = new Agent({
    id: "syncshot_agent",
    workspace: new Workspace({ path: agent_path }),
    model,
    instruction: ["instruction:initial"],
    plugins: [create_system_plugin("plugin-system:initial")],
  });

  try {
    const session = await agent.sessions.create({ session_id: session_id });
    const initial_text = (await session.system()).blocks
      .map((block) => block.content)
      .join("\n");
    assert.match(initial_text, /instruction:initial/);
    assert.match(initial_text, /plugin-system:initial/);

    agent.set_instruction(["instruction:refreshed"]);
    await agent.plugins.register(create_system_plugin("plugin-system:refreshed"));
    await session.syncshot();

    const refreshed_text = (await session.system()).blocks
      .map((block) => block.content)
      .join("\n");
    assert.match(refreshed_text, /instruction:refreshed/);
    assert.match(refreshed_text, /plugin-system:refreshed/);
    assert.doesNotMatch(refreshed_text, /instruction:initial/);
    await assert.rejects(fs.access(instruction_path));

    await session.snapshot();
    agent.set_instruction(["instruction:latest"]);
    await agent.plugins.register(create_system_plugin("plugin-system:latest"));
    await Promise.all([session.snapshot(), session.syncshot()]);

    const latest_system = await session.system();
    const latest_text = latest_system.blocks
      .map((block) => block.content)
      .join("\n");
    const persisted_text = await fs.readFile(instruction_path, "utf8");
    assert.match(latest_text, /instruction:latest/);
    assert.match(latest_text, /plugin-system:latest/);
    assert.equal(
      persisted_text,
      latest_system.blocks.map((block) => block.content).join("\n\n"),
    );
  } finally {
    await agent.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("Session snapshot explicitly persists the complete system to instruction.md", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-instruction-restart-"),
  );
  const model = new MockLanguageModelV3({ modelId: "instruction-restart-model" });
  const first_agent = new Agent({
    id: "instruction_restart_agent",
    workspace: new Workspace({ path: agent_path }),
    model,
    instruction: ["instruction:old"],
    plugins: [create_plugin({
      name: "snapshot-system",
      title: "Snapshot System",
      description: "Provides system text persisted by session.snapshot()",
      system: () => "plugin-system:persisted",
    })],
  });

  try {
    const session = await first_agent.sessions.create({
      session_id: "instruction_restart_session",
    });
    const first_system = await session.system();
    assert.match(
      first_system.blocks.map((block) => block.content).join("\n"),
      /instruction:old/,
    );
    await session.snapshot();

    const instruction_path = path.join(
      agent_path,
      ".downcity",
      "agents",
      "instruction_restart_agent",
      "sessions",
      "instruction_restart_session",
      "instruction.md",
    );
    const persisted_system = await fs.readFile(instruction_path, "utf8");
    assert.match(persisted_system, /instruction:old/);
    assert.match(persisted_system, /# Downcity Agent/);
    assert.match(persisted_system, /plugin-system:persisted/);
    assert.match(persisted_system, /Current session context:/);

    await fs.writeFile(instruction_path, "instruction:manual", "utf8");
    await session.snapshot();
    assert.equal(await fs.readFile(instruction_path, "utf8"), persisted_system);
  } finally {
    await first_agent.dispose();
  }

  const restarted_agent = new Agent({
    id: "instruction_restart_agent",
    workspace: new Workspace({ path: agent_path }),
    model,
    instruction: ["instruction:new"],
  });
  try {
    const restored_session = await restarted_agent.sessions.get(
      "instruction_restart_session",
    );
    const restored_system = await restored_session.system();
    const restored_system_text = restored_system.blocks
      .map((block) => block.content)
      .join("\n");
    assert.match(restored_system_text, /instruction:old/);
    assert.match(restored_system_text, /plugin-system:persisted/);
    assert.doesNotMatch(restored_system_text, /instruction:new/);
  } finally {
    await restarted_agent.dispose();
  }

  const instruction_path = path.join(
    agent_path,
    ".downcity",
    "agents",
    "instruction_restart_agent",
    "sessions",
    "instruction_restart_session",
    "instruction.md",
  );
  await fs.rm(instruction_path);

  const fallback_agent = new Agent({
    id: "instruction_restart_agent",
    workspace: new Workspace({ path: agent_path }),
    model,
    instruction: ["instruction:new"],
  });
  try {
    const fallback_session = await fallback_agent.sessions.get(
      "instruction_restart_session",
    );
    const fallback_system = await fallback_session.system();
    const fallback_system_text = fallback_system.blocks
      .map((block) => block.content)
      .join("\n");
    assert.match(fallback_system_text, /instruction:new/);
    assert.doesNotMatch(fallback_system_text, /instruction:old/);
  } finally {
    await fallback_agent.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("empty Session snapshot suppresses Agent instruction after restart", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-empty-instruction-snapshot-"),
  );
  const model = new MockLanguageModelV3({ modelId: "empty-snapshot-model" });
  const first_agent = new Agent({
    id: "empty_snapshot_agent",
    workspace: new Workspace({ path: agent_path }),
    model,
  });
  try {
    const session = await first_agent.sessions.create({
      session_id: "empty_snapshot_session",
    });
    await session.snapshot();
  } finally {
    await first_agent.dispose();
  }

  const restarted_agent = new Agent({
    id: "empty_snapshot_agent",
    workspace: new Workspace({ path: agent_path }),
    model,
    instruction: ["instruction:must-not-appear"],
  });
  try {
    const session = await restarted_agent.sessions.get("empty_snapshot_session");
    const system = await session.system();
    assert.doesNotMatch(
      system.blocks.map((block) => block.content).join("\n"),
      /instruction:must-not-appear/,
    );
  } finally {
    await restarted_agent.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("running session model changes apply with steer at the next Session step", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-step-boundary-"),
  );
  const old_model_started = create_deferred();
  const release_old_model = create_deferred();
  const model_calls = [];

  const old_model = new MockLanguageModelV3({
    modelId: "old-model",
    doStream: async (options) => {
      const has_tools = Array.isArray(options.tools) && options.tools.length > 0;
      if (!has_tools) return create_stream_text_result("Old title");
      model_calls.push("old-model");
      old_model_started.resolve();
      await release_old_model.promise;
      return create_stream_text_result("old response");
    },
  });
  const new_model = new MockLanguageModelV3({
    modelId: "new-model",
    doStream: async (options) => {
      const has_tools = Array.isArray(options.tools) && options.tools.length > 0;
      if (!has_tools) return create_stream_text_result("New title");
      model_calls.push("new-model");
      return create_stream_text_result("new response");
    },
  });
  const runtime_plugin = create_plugin({
    name: "model-boundary",
    title: "Model Boundary",
    description: "Ensures the main provider request has tools",
    actions: {
      ping: create_action({
        description: "Ping",
        execute: async () => ({ success: true, data: { ok: true } }),
      }),
    },
  });
  const agent = new Agent({
    id: "session_step_boundary_agent",
    workspace: new Workspace({ path: agent_path }),
    model: old_model,
    plugins: [runtime_plugin],
  });

  try {
    const session = await agent.sessions.create({
      session_id: "session_step_boundary_session",
    });
    await session.set({ model: old_model });
    const mutations = [];
    const unsubscribe = session.subscribe((mutation) => {
      mutations.push(mutation);
    });
    const first_turn = await session.prompt({ query: "first" });
    await old_model_started.promise;

    await session.set({
      model: new_model,
      security: { approval_mode: "always-allow" },
    });
    const steer_turn_promise = session.prompt({ query: "continue" });
    assert.deepEqual(model_calls, ["old-model"]);

    release_old_model.resolve();
    const steer_turn = await steer_turn_promise;
    assert.equal((await first_turn.finished).success, true);
    assert.equal(steer_turn.id, first_turn.id);
    assert.equal((await steer_turn.finished).success, true);
    assert.deepEqual(model_calls, ["old-model", "new-model"]);

    const messages = await session.messages();
    const model_actions = messages.items.filter(
      (message) =>
        message.type === "action" &&
        message.title === "Session configuration updated" &&
        message.description ===
          "model: new-model; security.approval_mode: always-allow",
    );
    assert.equal(model_actions.length, 1);
    assert.equal(model_actions[0].status, "completed");
    assert.equal(
      mutations.some(
        (mutation) =>
          mutation.variant === "message" &&
          mutation.type === "action" &&
          mutation.message.status === "completed" &&
          mutation.message.title === "Session configuration updated" &&
          mutation.message.description ===
            "model: new-model; security.approval_mode: always-allow",
      ),
      true,
    );
    unsubscribe();
  } finally {
    release_old_model.resolve();
    await agent.dispose();
  }
});

test("running session approval mode changes stay queued until the next Session step", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-approval-mode-boundary-"),
  );
  const first_provider_request_started = create_deferred();
  const release_first_provider_request = create_deferred();
  let provider_request_count = 0;
  const model = new MockLanguageModelV3({
    modelId: "approval-mode-boundary-model",
    doStream: async (options) => {
      const has_tools = Array.isArray(options.tools) && options.tools.length > 0;
      if (!has_tools) return create_stream_text_result("Approval title");
      provider_request_count += 1;
      if (provider_request_count === 1) {
        first_provider_request_started.resolve();
        await release_first_provider_request.promise;
      }
      return create_stream_text_result(`approval:${provider_request_count}`);
    },
  });
  const runtime_plugin = create_plugin({
    name: "approval-mode-boundary",
    title: "Approval Mode Boundary",
    description: "Keeps the provider request on the tool-enabled execution path",
    actions: {
      ping: create_action({
        description: "Ping",
        execute: async () => ({ success: true, data: { ok: true } }),
      }),
    },
  });
  const agent = new Agent({
    id: "approval_mode_boundary_agent",
    workspace: new Workspace({ path: agent_path }),
    model,
    plugins: [runtime_plugin],
  });

  try {
    const session = await agent.sessions.create({
      session_id: "approval_mode_boundary_session",
    });
    const first_turn = await session.prompt({ query: "first" });
    await first_provider_request_started.promise;

    await session.set({ security: { approval_mode: "always-allow" } });
    assert.deepEqual(await session.status(), {
      session_id: session.id,
      state: "running",
      active_turn_id: first_turn.id,
      security: {
        approval_mode: "always-allow",
        effective_approval_mode: "ask",
      },
    });

    const cached_session = await agent.sessions.get(session.id);
    assert.equal(cached_session, session);
    assert.deepEqual(await cached_session.status(), {
      session_id: session.id,
      state: "running",
      active_turn_id: first_turn.id,
      security: {
        approval_mode: "always-allow",
        effective_approval_mode: "ask",
      },
    });

    release_first_provider_request.resolve();
    assert.equal((await first_turn.finished).success, true);
    assert.deepEqual(await session.status(), {
      session_id: session.id,
      state: "idle",
      security: {
        approval_mode: "always-allow",
        effective_approval_mode: "ask",
      },
    });

    const second_turn = await session.prompt({ query: "second" });
    assert.equal((await second_turn.finished).success, true);
    assert.deepEqual(await session.status(), {
      session_id: session.id,
      state: "idle",
      security: {
        approval_mode: "always-allow",
        effective_approval_mode: "always-allow",
      },
    });
    const messages = await session.messages();
    assert.equal(
      messages.items.some(
        (message) =>
          message.type === "action" &&
          message.status === "completed" &&
          message.title === "Session configuration updated" &&
          message.description === "security.approval_mode: always-allow",
      ),
      true,
    );
  } finally {
    release_first_provider_request.resolve();
    await agent.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("session set options independently control Action persistence and Mutation publication", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-set-options-"),
  );
  const first_model = new MockLanguageModelV3({
    modelId: "set-options-first-model",
    doStream: async () => create_stream_text_result("first"),
  });
  const second_model = new MockLanguageModelV3({
    modelId: "set-options-second-model",
    doStream: async () => create_stream_text_result("second"),
  });
  const agent = new Agent({
    id: "session_set_options_agent",
    workspace: new Workspace({ path: agent_path }),
    model: first_model,
  });

  try {
    const session = await agent.sessions.create({
      session_id: "session_set_options_session",
    });
    const mutations = [];
    const unsubscribe = session.subscribe((mutation) => {
      mutations.push(mutation);
    });

    await session.set(
      { model: first_model },
      { persist_action: false, publish_mutation: false },
    );
    assert.equal((await (await session.prompt({ query: "first" })).finished).success, true);
    assert.equal(
      (await session.messages()).items.some(
        (message) =>
          message.type === "action" &&
          message.title === "Session configuration updated",
      ),
      false,
    );

    mutations.splice(0, mutations.length);
    await session.set(
      { model: second_model },
      { publish_mutation: false },
    );
    assert.equal((await (await session.prompt({ query: "second" })).finished).success, true);
    assert.equal(
      (await session.messages()).items.some(
        (message) =>
          message.type === "action" &&
          message.description === "model: set-options-second-model",
      ),
      true,
    );
    assert.equal(
      mutations.some(
        (mutation) =>
          mutation.variant === "message" &&
          mutation.type === "action",
      ),
      false,
    );

    const before_duplicate_count = (await session.messages()).items.filter(
      (message) =>
        message.type === "action" &&
        message.title === "Session configuration updated",
    ).length;
    await session.set({ model: second_model });
    assert.equal((await (await session.prompt({ query: "duplicate" })).finished).success, true);
    assert.equal(
      (await session.messages()).items.filter(
        (message) =>
          message.type === "action" &&
          message.title === "Session configuration updated",
      ).length,
      before_duplicate_count,
    );

    await assert.rejects(
      session.set(
        { security: { approval_mode: "always-allow" } },
        { persist_action: false, publish_mutation: true },
      ),
      /publish_mutation requires persist_action/,
    );
    unsubscribe();
  } finally {
    await agent.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("restored Session rebinds the same model without emitting a configuration Mutation", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-config-restore-"),
  );
  const create_model = () => new MockLanguageModelV3({
    modelId: "restored-session-model",
    doStream: async () => create_stream_text_result("restored"),
  });
  const first_agent = new Agent({
    id: "session_config_restore_agent",
    workspace: new Workspace({ path: agent_path }),
    model: create_model(),
  });

  try {
    const session = await first_agent.sessions.create({
      session_id: "session_config_restore_session",
    });
    await session.set({
      model: create_model(),
      security: { approval_mode: "always-allow" },
    });
    assert.equal((await (await session.prompt({ query: "persist" })).finished).success, true);
  } finally {
    await first_agent.dispose();
  }

  const restored_agent = new Agent({
    id: "session_config_restore_agent",
    workspace: new Workspace({ path: agent_path }),
    model: create_model(),
  });
  try {
    const session = await restored_agent.sessions.get(
      "session_config_restore_session",
    );
    assert.deepEqual((await session.status()).security, {
      approval_mode: "always-allow",
      effective_approval_mode: "always-allow",
    });
    const before_action_count = (await session.messages()).items.filter(
      (message) =>
        message.type === "action" &&
        message.title === "Session configuration updated",
    ).length;
    const mutations = [];
    const unsubscribe = session.subscribe((mutation) => {
      mutations.push(mutation);
    });

    await session.set({
      model: create_model(),
      security: { approval_mode: "always-allow" },
    });
    assert.equal((await (await session.prompt({ query: "restore" })).finished).success, true);
    assert.equal(
      (await session.messages()).items.filter(
        (message) =>
          message.type === "action" &&
          message.title === "Session configuration updated",
      ).length,
      before_action_count,
    );
    assert.equal(
      mutations.some(
        (mutation) =>
          mutation.variant === "message" &&
          mutation.type === "action" &&
          mutation.message.title === "Session configuration updated",
      ),
      false,
    );
    unsubscribe();
  } finally {
    await restored_agent.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("config remains effective when its action message cannot be persisted", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-config-action-observability-"),
  );
  const model_calls = [];
  const old_model = new MockLanguageModelV3({
    modelId: "old-observability-model",
    doStream: async () => {
      model_calls.push("old");
      return create_stream_text_result("old");
    },
  });
  const new_model = new MockLanguageModelV3({
    modelId: "new-observability-model",
    doStream: async () => {
      model_calls.push("new");
      return create_stream_text_result("new");
    },
  });
  const agent = new Agent({
    id: "config_action_observability_agent",
    workspace: new Workspace({ path: agent_path }),
    model: old_model,
  });

  try {
    const session = await agent.sessions.create({
      session_id: "config_action_observability_session",
    });
    await session.set({ model: old_model });
    const initial_turn = await session.prompt({ query: "initialize model" });
    assert.equal((await initial_turn.finished).success, true);
    model_calls.splice(0, model_calls.length);
    const initial_action_count = (await session.messages()).items.filter(
      (message) => message.type === "action",
    ).length;

    session.session_messages.persist_action_record = async () => {
      throw new Error("action store unavailable");
    };

    await session.set({ model: new_model });
    const turn = await session.prompt({ query: "use configured model" });
    assert.equal((await turn.finished).success, true);
    assert.deepEqual(model_calls, ["new"]);

    const messages = await session.messages();
    assert.equal(
      messages.items.filter((message) => message.type === "action").length,
      initial_action_count,
    );
  } finally {
    await agent.dispose();
  }
});

/**
 * @file 验证独立 AgentHTTP 与 RemoteAgent 的核心 HTTP 契约。
 *
 * 关键点（中文）
 * - events 必须转发统一 SessionMutation，RemoteSession 的 turn.finished 才能结束。
 * - AgentHTTP 必须暴露 RemoteAgent 的 plugin action 路由，不能只提供 session 路由。
 */

import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { RemoteAgent } from "../../agent/bin/index.js";
import { AgentHTTP } from "../bin/index.js";

async function reserve_port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function create_fake_agent() {
  const subscribers = new Set();
  let compact_count = 0;
  let approval_mode = "ask";
  const info = {
    agent_id: "http-test-agent",
    session_id: "http-test-session",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const session = {
    async get_info() {
      return info;
    },
    async prompt() {
      queueMicrotask(() => {
        for (const subscriber of subscribers) {
          subscriber({
            mutation_id: "turn-start-http-test",
            variant: "turn",
            type: "start",
            session_id: info.session_id,
            turn_id: "turn-http-test",
            status: "running",
            created_at: Date.now(),
          });
          subscriber({
            variant: "delta",
            type: "text",
            mutation_id: "mutation-http-test",
            message_id: "message-http-test",
            revision: 1,
            session_id: info.session_id,
            turn_id: "turn-http-test",
            created_at: Date.now(),
            part_id: "part-http-test",
            delta: "HTTP transport works",
          });
          subscriber({
            mutation_id: "approval-http-mutation",
            variant: "part",
            type: "interaction",
            session_id: info.session_id,
            turn_id: "turn-http-test",
            message_id: "message-http-test",
            revision: 2,
            created_at: Date.now(),
            part_id: "interaction:interaction-http-test",
            part: {
              part_id: "interaction:interaction-http-test",
              sequence: 2,
              type: "interaction",
              interaction_id: "interaction-http-test",
              interaction_type: "approval",
              status: "pending",
              request: {
                interaction_id: "interaction-http-test",
                turn_id: "turn-http-test",
                kind: "approval",
                source: {
                  type: "tool",
                  tool_call_id: "call-http-test",
                  tool_name: "shell_exec",
                },
                title: "Approve shell_exec",
                command: "pwd",
                cwd: "/tmp",
                reason: "test",
                operation: "exec",
                created_at: Date.now(),
                expires_at: Date.now() + 60_000,
              },
            },
          });
          subscriber({
            mutation_id: "turn-finish-http-test",
            variant: "turn",
            type: "finish",
            session_id: info.session_id,
            turn_id: "turn-http-test",
            status: "completed",
            created_at: Date.now(),
            text: "HTTP transport works",
          });
        }
      });
      return { id: "turn-http-test" };
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    async set(input) {
      if (input.security?.approval_mode) {
        approval_mode = input.security.approval_mode;
      }
    },
    async stop() {
      return { stopped: false, cancelled_queued_prompts: 0, reason: "idle" };
    },
    async compact() {
      compact_count += 1;
    },
    async messages() {
      return { items: [], total: 0, source: "active", has_more: false };
    },
    async system() {
      return { session_id: info.session_id, session: info, blocks: [] };
    },
    async interactions() {
      return [{
        request: {
          interaction_id: "interaction-http-test",
          turn_id: "turn-http-test",
          kind: "approval",
          source: { type: "tool", tool_call_id: "call-http-test", tool_name: "shell_exec" },
          title: "Approve shell_exec",
          command: "pwd",
          cwd: "/tmp",
          reason: "test",
          operation: "exec",
          created_at: Date.now(),
        },
      }];
    },
    async status() {
      return {
        session_id: info.session_id,
        state: "idle",
        security: {
          approval_mode,
          effective_approval_mode: "ask",
        },
      };
    },
    async respond({ interaction_id, response }) {
      return { status: "resolved", interaction_id, response };
    },
    async fork() {
      return session;
    },
  };
  return {
    read_compact_count() {
      return compact_count;
    },
    sessions: {
      async list() {
        return { items: [info], has_more: false };
      },
      async create() {
        return session;
      },
      async get() {
        return session;
      },
      async archive() {
        return { session_id: info.session_id, archived_at: new Date().toISOString() };
      },
      async archived() {
        return { items: [], has_more: false };
      },
      async clean_archive() {
        return { removed_session_ids: [] };
      },
    },
    plugins: {
      async run_action({ plugin, action, payload }) {
        return { success: true, data: { plugin, action, payload } };
      },
    },
  };
}

test("AgentHTTP resolves RemoteAgent turns and exposes plugin actions", async () => {
  const port = await reserve_port();
  const fake_agent = create_fake_agent();
  const http = new AgentHTTP(fake_agent);
  const remote_agent = new RemoteAgent({ url: `http://127.0.0.1:${port}` });
  try {
    await http.server().listen({ host: "127.0.0.1", port });
    const session = await remote_agent.sessions.create();
    const mutations = [];
    let approval_decision;
    const unsubscribe = session.subscribe((mutation) => {
      mutations.push(mutation);
      if (
        mutation.variant === "part" &&
        mutation.type === "interaction" &&
        mutation.part.status === "pending"
      ) {
        approval_decision = session.respond({
          interaction_id: mutation.part.interaction_id,
          response: { kind: "approval", decision: "approved" },
        });
      }
    });
    const turn = await session.prompt({ query: "test" });
    const result = await turn.finished;
    unsubscribe();

    assert.equal(result.success, true);
    assert.equal(result.text, "HTTP transport works");
    assert.deepEqual(mutations.map((mutation) => mutation.variant), ["turn", "delta", "part", "turn"]);
    assert.equal(mutations[1].delta, "HTTP transport works");
    assert.deepEqual(await approval_decision, {
      status: "resolved",
      interaction_id: "interaction-http-test",
      response: { kind: "approval", decision: "approved" },
    });

    assert.equal((await session.interactions())[0].request.interaction_id, "interaction-http-test");
    await session.set({ security: { approval_mode: "always-allow" } });
    assert.deepEqual((await session.status()).security, {
      approval_mode: "always-allow",
      effective_approval_mode: "ask",
    });
    assert.deepEqual(
      await session.respond({
        interaction_id: "interaction-http-test",
        response: { kind: "approval", decision: "approved" },
      }),
      {
        status: "resolved",
        interaction_id: "interaction-http-test",
        response: { kind: "approval", decision: "approved" },
      },
    );
    await session.compact();
    assert.equal(fake_agent.read_compact_count(), 1);

    const action = await remote_agent.run_plugin_action({
      plugin: "demo",
      action: "echo",
      payload: { text: "hello" },
    });
    assert.deepEqual(action, {
      success: true,
      data: {
        plugin: "demo",
        action: "echo",
        payload: { text: "hello" },
      },
      plugin_name: "demo",
      action_name: "echo",
    });
  } finally {
    await remote_agent.close();
    await http.close();
  }
});

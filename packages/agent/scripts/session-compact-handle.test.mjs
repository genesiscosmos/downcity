/**
 * @file 验证 session.compact() 的队列顺序与 Handle 完成语义。
 *
 * 关键点（中文）
 * - `compact()` 只返回已入队 Handle，不在空闲期主动创建 Turn。
 * - 后续 Prompt 必须等待排在它前面的 Compact Command 真正完成后才启动。
 * - `result` 与 `finished` 使用同一个稳定领域结果。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";

import {
  Agent,
  DefaultSessionComposer,
  Session,
  Workspace,
} from "../bin/index.js";

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
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  };
}

test("compact Handle 在队列命令完成后兑现并阻塞后续 Prompt", async () => {
  const compact_started = create_deferred();
  const release_compact = create_deferred();

  class CompactComposer extends DefaultSessionComposer {
    async compact() {
      compact_started.resolve();
      await release_compact.promise;
      return null;
    }
  }

  class CompactSession extends Session {
    constructor(options) {
      super({ ...options, composer: new CompactComposer() });
    }
  }

  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-compact-handle-"),
  );
  const agent = new Agent({
    id: "compact_handle_agent",
    model: new MockLanguageModelV3({
      modelId: "compact-handle-model",
      doStream: async () => create_stream_text_result("done"),
    }),
    session_class: CompactSession,
  });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: project_root }));

  try {
    const session = await entry.sessions.create({
      session_id: "compact_handle_session",
    });
    const compact_handle = await session.compact();
    assert.equal(compact_handle.result, null);

    let prompt_returned = false;
    const prompt_promise = session.prompt({ query: "continue" }).then((handle) => {
      prompt_returned = true;
      return handle;
    });
    await compact_started.promise;
    assert.equal(prompt_returned, false);
    assert.equal(compact_handle.result, null);

    release_compact.resolve();
    const turn_handle = await prompt_promise;
    const compact_result = await compact_handle.finished;
    assert.deepEqual(compact_result, {
      compact_id: compact_handle.id,
      success: true,
      compacted: false,
      reason: "nothing_to_compact",
    });
    assert.deepEqual(compact_handle.result, compact_result);
    assert.equal((await turn_handle.finished).success, true);
  } finally {
    release_compact.resolve();
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});

/**
 * @file 验证 UI stream 收敛时 canonical message 回调失败会终止执行。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { collectFinalAssistantMessageFromUiStream } from "../bin/executor/core-engine/CoreEngineUiStreamCollector.js";

test("canonical message chunk 写入失败时拒绝继续完成 turn", async () => {
  const abort_controller = new AbortController();
  abort_controller.abort();
  const result = {
    toUIMessageStream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "text-delta", id: "text-1", delta: "partial" };
      },
    }),
  };

  await assert.rejects(
    collectFinalAssistantMessageFromUiStream({
      result,
      session_id: "callback-failure-test",
      abortSignal: abort_controller.signal,
      logger: { log: async () => {} },
      buildFallbackAssistantMessage: (text) => ({
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text }],
      }),
      on_ui_message_chunk_callback: async () => {
        throw new Error("canonical write failed");
      },
    }),
    /canonical write failed/,
  );
});

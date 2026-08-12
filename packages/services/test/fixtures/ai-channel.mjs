/**
 * Services 集成测试使用的固定文本 AIChannel。
 *
 * 测试模型通过与生产代码一致的 `AIChannel.model()` 注册，避免测试夹具绕过
 * City AI 的 runtime 结构与 LanguageModelV3 执行边界。
 */

import { AIChannel } from "@downcity/federation"

/**
 * 创建输出固定文本的标准 AIChannel 模型定义。
 *
 * @param {object} options 测试模型配置。
 * @param {string} options.id Federation 对外模型 ID。
 * @param {string} [options.name] 模型展示名称。
 * @param {string} [options.text] 模型输出文本。
 * @param {Function} [options.bill] 模型账单函数。
 * @param {Function} [options.on_stream] 每次调用模型流时执行的观察函数。
 * @param {boolean} [options.fail] 是否模拟模型执行失败。
 * @returns {import("@downcity/federation").AIModelDefinition} 可注册到 AIService 的模型定义。
 */
export function create_test_text_model({
  id,
  name = id,
  text = "ok",
  bill,
  on_stream,
  fail = false,
}) {
  class TestTextChannel extends AIChannel {
    async stream(input) {
      on_stream?.(input)
      if (fail) throw new Error("test model failure")
      return create_text_stream(text)
    }
  }

  const channel = new TestTextChannel({ id: `test-${id}` })
  return channel.model({
    id,
    upstream_model: id,
    name,
    ...(bill ? { bill } : {}),
  })
}

/** 创建满足 LanguageModelV3 契约的固定文本流。 */
function create_text_stream(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: "text_1" })
        controller.enqueue({ type: "text-delta", id: "text_1", delta: text })
        controller.enqueue({ type: "text-end", id: "text_1" })
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        })
        controller.close()
      },
    }),
  }
}

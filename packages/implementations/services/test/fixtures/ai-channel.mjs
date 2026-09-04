/**
 * Services 集成测试使用的固定文本 AIChannel。
 *
 * 测试模型通过与生产代码一致的 `AIChannel.model()` 注册，避免测试夹具绕过
 * City AI 的 runtime 结构与 Downcity Model Protocol 执行边界。
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
      return create_text_stream(id, text)
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

/** 创建满足 Downcity Model Protocol 契约的固定文本流。 */
function create_text_stream(model_id, text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "model_start", request_id: "request_1", model_id })
        controller.enqueue({ type: "text_start", content_id: "text_1" })
        controller.enqueue({ type: "text_delta", content_id: "text_1", delta: text })
        controller.enqueue({ type: "text_finish", content_id: "text_1" })
        controller.enqueue({
          type: "model_usage",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        })
        controller.enqueue({ type: "model_finish", finish_reason: "stop" })
        controller.close()
      },
    }),
  }
}

/**
 * Agent 测试使用的可编程 Downcity ModelClient。
 *
 * 旧测试夹具可以继续用分块构造器表达场景，本模块只在测试进程内把这些分块
 * 规范化为 ModelStreamEvent，不进入 SDK 产物或公开协议。
 */

export class MockModelClient {
  constructor(options = {}) {
    this.id = options.modelId || options.id || "mock-model";
    this.stream_handler = options.stream || options.doStream;
    this.generate_handler = options.generate || options.doGenerate;
  }

  async stream(call) {
    if ((!call.tools || call.tools.length === 0) && this.generate_handler) {
      const generated = await this.generate_handler(to_fixture_call(call));
      return generate_result_stream(this.id, generated);
    }
    if (!this.stream_handler) {
      return generate_result_stream(this.id, await this.generate_handler(to_fixture_call(call)));
    }
    const result = await this.stream_handler(to_fixture_call(call));
    return normalize_fixture_stream(this.id, result.stream ?? result);
  }
}

function to_fixture_call(call) {
  return {
    ...call,
    prompt: call.messages.map((message) => ({
      role: message.role,
      content: message.content.map(to_fixture_content),
    })),
    tools: call.tools?.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema,
      providerOptions: undefined,
    })),
  };
}

function to_fixture_content(part) {
  if (part.type === "tool_call") {
    return { type: "tool-call", toolCallId: part.tool_call_id, toolName: part.tool_name, input: part.input };
  }
  if (part.type === "tool_result") {
    return {
      type: "tool-result", toolCallId: part.tool_call_id, toolName: part.tool_name,
      output: part.content,
    };
  }
  if (part.type !== "file") return part;
  return {
    type: "file",
    mediaType: part.media_type,
    data: part.source.type === "base64" ? part.source.data : part.source.url,
    ...(part.filename ? { filename: part.filename } : {}),
  };
}

function generate_result_stream(model_id, result = {}) {
  const content = Array.isArray(result.content)
    ? result.content
    : [{ type: "text", text: String(result.text || "") }];
  return new ReadableStream({ start(controller) {
    controller.enqueue({ type: "model_start", request_id: `req_${crypto.randomUUID()}`, model_id });
    for (const [index, part] of content.entries()) {
      const content_id = `${part.type}_${String(index + 1)}`;
      if (part.type === "text" && part.text) {
        controller.enqueue({ type: "text_start", content_id });
        controller.enqueue({ type: "text_delta", content_id, delta: part.text });
        controller.enqueue({ type: "text_finish", content_id });
      } else if (part.type === "tool_call") {
        controller.enqueue({
          type: "tool_call_start",
          content_id,
          tool_call_id: part.tool_call_id,
          tool_name: part.tool_name,
        });
        controller.enqueue({ type: "tool_call_finish", content_id, input: part.input });
      } else if (part.type === "error") {
        controller.enqueue({
          type: "model_error",
          error: {
            code: "provider_error",
            message: String(part.error || "Provider error"),
            retryable: false,
          },
        });
        controller.close();
        return;
      }
    }
    controller.enqueue({ type: "model_usage", usage: normalize_usage(result.usage) });
    controller.enqueue({ type: "model_finish", finish_reason: normalize_finish_reason(result.finishReason) });
    controller.close();
  } });
}

function normalize_fixture_stream(model_id, stream) {
  const reader = stream.getReader();
  return new ReadableStream({
    async start(controller) {
      const tools = new Map();
      let started = false;
      let finished = false;
      const ensure_started = () => {
        if (started) return;
        started = true;
        controller.enqueue({ type: "model_start", request_id: `req_${crypto.randomUUID()}`, model_id });
      };
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const part = chunk.value;
          if (!part || typeof part !== "object") continue;
          ensure_started();
          if (part.type === "text-start") controller.enqueue({ type: "text_start", content_id: part.id });
          else if (part.type === "text-delta") controller.enqueue({ type: "text_delta", content_id: part.id, delta: part.delta });
          else if (part.type === "text-end") controller.enqueue({ type: "text_finish", content_id: part.id });
          else if (part.type === "reasoning-start") controller.enqueue({ type: "reasoning_start", content_id: part.id });
          else if (part.type === "reasoning-delta") controller.enqueue({ type: "reasoning_delta", content_id: part.id, delta: part.delta });
          else if (part.type === "reasoning-end") controller.enqueue({ type: "reasoning_finish", content_id: part.id });
          else if (part.type === "tool-input-start") {
            tools.set(part.id, { name: part.toolName, input: "", started: true });
            controller.enqueue({ type: "tool_call_start", content_id: part.id, tool_call_id: part.id, tool_name: part.toolName });
          } else if (part.type === "tool-input-delta") {
            const tool = tools.get(part.id) ?? { name: "", input: "", started: false };
            tool.input += part.delta;
            tools.set(part.id, tool);
            controller.enqueue({ type: "tool_call_delta", content_id: part.id, input_delta: part.delta });
          } else if (part.type === "tool-call") {
            const id = part.toolCallId;
            const tool = tools.get(id) ?? { name: part.toolName, input: "", started: false };
            if (!tool.started) {
              controller.enqueue({ type: "tool_call_start", content_id: id, tool_call_id: id, tool_name: part.toolName });
            }
            controller.enqueue({
              type: "tool_call_finish", content_id: id,
              input: typeof part.input === "string" ? JSON.parse(part.input || "{}") : part.input,
            });
          } else if (part.type === "finish") {
            controller.enqueue({ type: "model_usage", usage: normalize_usage(part.usage) });
            controller.enqueue({ type: "model_finish", finish_reason: normalize_finish_reason(part.finishReason) });
            finished = true;
          } else if (part.type === "error") {
            controller.enqueue({ type: "model_error", error: { code: "provider_error", message: String(part.error || "Provider error"), retryable: false } });
            finished = true;
          }
        }
        ensure_started();
        if (!finished) controller.enqueue({ type: "model_finish", finish_reason: "stop" });
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function normalize_usage(usage = {}) {
  const input_tokens = Number(usage.input_tokens ?? usage.inputTokens?.total ?? 0);
  const output_tokens = Number(usage.output_tokens ?? usage.outputTokens?.total ?? 0);
  return { input_tokens, output_tokens, total_tokens: input_tokens + output_tokens };
}

function normalize_finish_reason(value) {
  const reason = typeof value === "string" ? value : value?.unified;
  if (reason === "tool-calls" || reason === "tool_calls") return "tool_call";
  if (["stop", "length", "content_filter", "cancelled", "error", "unknown"].includes(reason)) return reason;
  return "stop";
}

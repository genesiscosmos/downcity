/**
 * Federation Provider replay 作用域模块。
 *
 * Provider metadata 中的 item ID、encrypted reasoning 和文件引用只对产生它们的
 * Channel / 模型 / Provider 有效。Federation 在 fallback 完成后过滤输入，并在输出上
 * 标记一次不可拆分的 Provider 响应组，避免跨 Provider 重放私有协议状态。
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "../../types/AI.js";

/** Downcity 写入 Provider metadata 的固定命名空间。 */
const DOWNCITY_PROVIDER_ID = "downcity";

/** 单次 Provider 响应的稳定来源作用域。 */
interface ProviderReplayScope {
  /** 产生响应的 Federation Channel ID。 */
  channel_id: string;
  /** 路由和 fallback 完成后的 Federation 模型 ID。 */
  model_id: string;
  /** 真实 AI SDK Provider options 命名空间。 */
  provider_id: string;
  /** 同一次上游响应的原子分组 ID。 */
  group_id: string;
}

/** 创建一次上游调用的 Provider replay 作用域。 */
export function create_provider_replay_scope(input: {
  /** 当前 Channel ID。 */
  channel_id: string;
  /** 最终 Federation 模型 ID。 */
  model_id: string;
  /** 当前 AI SDK Provider ID；未配置时不启用 replay。 */
  provider_id?: string;
}): ProviderReplayScope | undefined {
  const provider_id = String(input.provider_id || "").trim();
  if (!provider_id) return undefined;
  return {
    channel_id: input.channel_id,
    model_id: input.model_id,
    provider_id,
    group_id: crypto.randomUUID(),
  };
}

/**
 * 按最终路由结果生成 Provider 可消费的 prompt。
 *
 * 无作用域、作用域不匹配或来自其它 Provider 的 metadata 都降级为纯语义历史。
 */
export function prepare_provider_replay_call(
  call: LanguageModelV3CallOptions,
  scope: ProviderReplayScope | undefined,
): LanguageModelV3CallOptions {
  return {
    ...call,
    prompt: call.prompt.map((message) => {
      const message_record = message as unknown as Record<string, unknown>;
      const {
        providerOptions: _provider_options,
        ...semantic_message
      } = message_record;
      const content = Array.isArray(message_record.content)
        ? message_record.content.map((part) =>
            prepare_provider_replay_part(
              part as Record<string, unknown>,
              scope,
            )
          )
        : message_record.content;
      const provider_options = select_scoped_provider_options(
        message_record.providerOptions,
        scope,
      );
      return {
        ...semantic_message,
        content,
        ...(provider_options ? { providerOptions: provider_options } : {}),
      } as typeof message;
    }),
  };
}

/** 为 Federation 返回的 Provider metadata 附加不可拆分的响应作用域。 */
export function scope_provider_replay_stream(
  result: LanguageModelV3StreamResult,
  scope: ProviderReplayScope | undefined,
): LanguageModelV3StreamResult {
  if (!scope) return result;
  const source = result.stream;
  return {
    ...result,
    stream: source.pipeThrough(new TransformStream<
      LanguageModelV3StreamPart,
      LanguageModelV3StreamPart
    >({
      transform(part, controller) {
        controller.enqueue(scope_provider_replay_part(part, scope));
      },
    })),
  };
}

/** 清理单个 prompt Part 的 Provider options。 */
function prepare_provider_replay_part(
  part: Record<string, unknown>,
  scope: ProviderReplayScope | undefined,
): Record<string, unknown> {
  const {
    providerOptions: _provider_options,
    ...semantic_part
  } = part;
  const provider_options = select_scoped_provider_options(
    part.providerOptions,
    scope,
  );
  return {
    ...semantic_part,
    ...(provider_options ? { providerOptions: provider_options } : {}),
  };
}

/** 只选取与最终 Channel / 模型 / Provider 一致的私有 options。 */
function select_scoped_provider_options(
  value: unknown,
  expected_scope: ProviderReplayScope | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!expected_scope) return undefined;
  const provider_options = read_record(value);
  const downcity_options = read_record(provider_options?.[DOWNCITY_PROVIDER_ID]);
  const replay_scope = read_replay_scope(downcity_options?.replay_scope);
  if (!replay_scope || !same_provider_scope(replay_scope, expected_scope)) {
    return undefined;
  }
  const selected_options = read_record(
    provider_options?.[expected_scope.provider_id],
  );
  return selected_options
    ? { [expected_scope.provider_id]: selected_options }
    : undefined;
}

/** 为单个标准 V3 流事件添加 replay scope。 */
function scope_provider_replay_part(
  part: LanguageModelV3StreamPart,
  scope: ProviderReplayScope,
): LanguageModelV3StreamPart {
  const part_record = part as unknown as Record<string, unknown>;
  const provider_metadata = read_record(part_record.providerMetadata);
  if (!provider_metadata || !read_record(provider_metadata[scope.provider_id])) {
    return part;
  }
  return {
    ...part_record,
    providerMetadata: {
      ...provider_metadata,
      [DOWNCITY_PROVIDER_ID]: {
        ...read_record(provider_metadata[DOWNCITY_PROVIDER_ID]),
        replay_scope: scope,
      },
    },
  } as unknown as LanguageModelV3StreamPart;
}

/** 校验历史 replay 是否属于当前最终路由。 */
function same_provider_scope(
  actual: ProviderReplayScope,
  expected: ProviderReplayScope,
): boolean {
  return (
    actual.channel_id === expected.channel_id &&
    actual.model_id === expected.model_id &&
    actual.provider_id === expected.provider_id
  );
}

/** 把未知值解码为 Provider replay scope。 */
function read_replay_scope(value: unknown): ProviderReplayScope | undefined {
  const record = read_record(value);
  if (!record) return undefined;
  const channel_id = read_string(record.channel_id);
  const model_id = read_string(record.model_id);
  const provider_id = read_string(record.provider_id);
  const group_id = read_string(record.group_id);
  return channel_id && model_id && provider_id && group_id
    ? { channel_id, model_id, provider_id, group_id }
    : undefined;
}

/** 安全读取普通 object。 */
function read_record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** 读取非空字符串。 */
function read_string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

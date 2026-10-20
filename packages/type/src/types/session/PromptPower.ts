/**
 * 请求级 Power 契约：描述可跨端传输，执行函数由调用方持有。
 * 不依赖 City 上下文或具体 Transport，生命周期由一个 Session Turn 管理。
 */
import type { ModelJsonValue } from "../model/ModelJson.js";

/** Action 的可序列化调用示例。 */
export interface PromptPowerActionExample {
  /** 示例标题。 */
  readonly title: string;
  /** 可选补充说明。 */
  readonly description?: string;
  /** 示例参数。 */
  readonly payload: ModelJsonValue;
}

/** 可序列化的 Action 定义。 */
export interface PromptPowerActionDescriptor {
  /** 模型可读的用途说明。 */
  readonly description?: string;
  /** 返回值结构说明。 */
  readonly returns?: string;
  /** 读写元数据，不自动触发审批。 */
  readonly access?: "read" | "write";
  /** 面向模型的调用示例，沿用 City Power 的示例结构。 */
  readonly examples?: readonly PromptPowerActionExample[];
  /** Action 输入 JSON Schema，仅接受可在本地编译的 schema。 */
  readonly input_schema: Record<string, unknown>;
  /** 协作式执行时限；省略时为 60 秒，最大 5 分钟。 */
  readonly timeout_ms?: number;
}

/** 可序列化的请求级 Power。 */
export interface PromptPowerDescriptor {
  /** 模型工具名，在本次 Turn 内必须唯一。 */
  readonly name: string;
  /** 用户可读标题。 */
  readonly title?: string;
  /** 模型可读的能力说明。 */
  readonly description: string;
  /** 只对当前 Turn 生效的使用指令。 */
  readonly instruction?: string;
  /** 动作名到描述的映射，至少包含一个动作。 */
  readonly actions: Readonly<Record<string, PromptPowerActionDescriptor>>;
}

/** 调用方获得的最小执行上下文。 */
export interface PromptPowerCallContext {
  /** 执行所属 Agent。 */
  readonly agent_id: string;
  /** 执行所属 Session。 */
  readonly session_id: string;
  /** 执行所属 Turn。 */
  readonly turn_id: string;
  /** 模型工具调用标识。 */
  readonly tool_call_id: string;
  /** 单次真实 Action 执行标识，可用于业务幂等。 */
  readonly call_id: string;
  /** 停止或超时时触发的协作取消信号。 */
  readonly abort_signal: AbortSignal;
}

/** 调用方持有的可执行 Action。 */
export interface PromptPowerAction extends PromptPowerActionDescriptor {
  /** 执行已校验输入，直接返回 JSON 结果；函数不通过网络传输。 */
  readonly execute: (input: ModelJsonValue, context: PromptPowerCallContext) => ModelJsonValue | Promise<ModelJsonValue>;
}

/** 可用于 session.prompt({ powers }) 的轻量 Power。 */
export interface PromptPower extends PromptPowerDescriptor {
  /** 提供方生命周期信号；中断时结束使用该能力的 Turn，不传到网络。 */
  readonly abort_signal?: AbortSignal;
  /** 可执行动作集合；已有 City Power 通过显式宿主适配导出。 */
  readonly actions: Readonly<Record<string, PromptPowerAction>>;
}

/** 已去除函数的网络执行请求。 */
export interface PromptPowerCall extends Omit<PromptPowerCallContext, "abort_signal"> {
  /** 目标 Power 名称。 */
  readonly power_name: string;
  /** 目标 Action 名称。 */
  readonly action_name: string;
  /** 已通过 schema 校验的参数。 */
  readonly input: ModelJsonValue;
}

/** 执行通道消息，独立于 SessionMutation。 */
export type PromptPowerEvent =
  | { /** 执行请求。 */ readonly type: "call"; /** 调用内容。 */ readonly call: PromptPowerCall }
  | { /** 取消请求。 */ readonly type: "cancel"; /** 调用标识。 */ readonly call_id: string };

/** 远程执行结果，不包含函数或客户端资源句柄。 */
export interface PromptPowerResult {
  /** 对应调用标识。 */
  readonly call_id: string;
  /** 成功时返回 JSON output。 */
  readonly output?: ModelJsonValue;
  /** 失败时返回稳定错误说明。 */
  readonly error?: string;
}

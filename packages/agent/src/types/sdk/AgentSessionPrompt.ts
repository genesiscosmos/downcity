/**
 * Agent Session prompt 输入类型定义。
 *
 * 关键点（中文）
 * - `prompt()` 是 Session actor 模型下唯一的输入入口。
 * - 首条输入、运行中补充输入、排队到下一轮的输入，调用侧都使用同一结构。
 */

import type { SessionPromptActor } from "./SessionPromptActor.js";
import type { SessionCallback } from "@/types/agent/SessionCallback.js";
import type { SessionUserContent, PromptPower } from "@downcity/type";

/**
 * Session user message part 类型。
 *
 * 说明（中文）
 * - 这是 Downcity Session 输入边界，不依赖模型协议或第三方 SDK。
 * - 可直接用于 `session.prompt({ actor, query: [...parts] })` 传入 text、context、file 等 parts。
 */
export type AgentSessionPromptContent = SessionUserContent;

/**
 * Session prompt 输入。
 *
 * 输入示例（中文）：
 * ```ts
 * session.prompt({
 *   query: "请分析这个附件",
 * });
 * ```
 *
 * 调用对象（中文）：
 * - `actor` 省略时按本地用户处理，适用于宿主直接转发的用户输入。
 * - 自动执行入口（Group、Task、跨 Session 委派等）必须显式声明真实身份，
 *   否则其输入会被当成用户输入并入用户的 Turn。
 *
 * 生命周期说明（中文）：
 * - `string` 会直接成为新的文本 User Message。
 * - `file` part 如果携带 Data URL，会在 Message 入库前解码到 Session 的 attachments 目录。
 * - 持久化 Message 里的 `url` 变成相对 Workspace 根目录的文件路径，而不是 Base64 内容。
 * - 模型执行前，Executor 再按该路径读取文件，并转换成 Downcity `ModelMessage`。
 * - 远程 Session 中，Data URL 在服务端落盘；调用方本地路径必须对服务端可访问。
 */
export interface AgentSessionPromptInput {
  /** 只在创建本次 Turn 时装配的调用方 Powers；运行中追加输入不能替换。 */
  powers?: readonly PromptPower[];
  /**
   * 由可信宿主绑定的调用对象；省略时为本地用户。
   *
   * 占用仲裁与幂等归属都按它判定，自动执行入口必须显式给出真实身份。
   */
  actor?: SessionPromptActor;
  /** 本次输入所属 Turn 完成后的持久化回调；需要非空 request_id。 */
  callback?: SessionCallback;
  /**
   * 调用方为同一业务输入提供的稳定幂等标识。
   *
   * 说明（中文）
   * - 相同 Session 内重复提交同一个 `request_id`，只会创建一条 canonical User Message。
   * - 已完成的请求直接返回实际绑定的 Turn 结果；进程重启后未完成的请求会复用原 Turn 恢复执行。
   * - 输入并入运行中的 Turn 时仍保留稳定消息标识，不要求 Turn ID 等于请求推导标识。
   * - 幂等输入在入库前被 stop 取消或持久化失败时 prompt 会 reject，调用方可用同一标识重试。
   * - 不同业务输入不得复用同一个值；不需要跨进程重试的交互式调用可以省略。
   */
  request_id?: string;

  /**
   * 消息的展示可见性，默认 `visible`。
   *
   * `internal` 用于委派结果等运行时输入：消息仍持久化、进入模型上下文并触发执行，
   * 但不在普通会话历史和聊天界面展示。该字段不改变模型输入角色或指令优先级。
   */
  visibility?: "visible" | "internal";

  /**
   * 当前这次要追加到 Session 的用户文本或 parts 数组。
   *
   * 说明（中文）
   * - 支持两种格式：
   *   1. `string`：纯文本用户输入，Session 会将其包装为用户消息。
   *   2. `AgentSessionPromptContent[]`：Downcity Session 内容，可直接携带 text、context、file 等内容。
   * - 调用侧只传本次新增输入；运行时输入应同时设置 `visibility: "internal"`。
   * - 它是否并入当前 turn，还是排到下一 turn，由 Session 内部决定。
   */
  query: string | AgentSessionPromptContent[];
}

/** 已确定调用对象的 prompt 输入；Session 内部只处理这种形状。 */
export type NormalizedAgentSessionPromptInput =
  AgentSessionPromptInput & { actor: SessionPromptActor };

/**
 * 判断 prompt 输入是否为空。
 *
 * 说明（中文）
 * - `string`：trim 后为空即视为空。
 * - `AgentSessionPromptContent[]`：数组为空，或仅包含空文本和空 Context 时视为空。
 */
export function is_agent_session_prompt_input_empty(input: AgentSessionPromptInput): boolean {
  const query = input.query;
  if (typeof query === "string") {
    return query.trim() === "";
  }
  if (Array.isArray(query)) {
    if (query.length === 0) {
      return true;
    }
    // 只有空文本与空 Context 的输入没有可执行语义。
    return query.every((part) => {
      if (part.type === "text") return part.text.trim() === "";
      if (part.type === "context") return part.context.trim() === "";
      return false;
    });
  }
  return true;
}

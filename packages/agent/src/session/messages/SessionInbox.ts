/**
 * 可信 Prompt 到 Inbox 输入的归一化边界。
 *
 * 文件在提交前进入 Session 附件存储；来源与请求记账独立于模型正文保存。
 * 本模块不创建 Message，不持有 Writer，也不决定 Turn 的执行策略。
 */
import type { SessionInboxInput, SessionModelUserContent } from "@downcity/type";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";
import type { NormalizedAgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import { persist_user_prompt_file_parts } from "@/model/messages/SessionAttachmentMapper.js";
import { build_session_message_meta } from "./SessionMessageMeta.js";
import { normalize_inbox_content } from "./SessionUserMessage.js";

/** 运行时 Prompt 的准备参数。 */
export interface PrepareSessionPromptInboxInput {
  /** 已归一化真实调用身份的输入。 */
  prompt: NormalizedAgentSessionPromptInput;
  /** 来源为本次输入提供的稳定幂等标识。 */
  inbox_id: string;
  /** 当前项目根目录，供调用边界保持一致的路径语义。 */
  project_root: string;
  /** 附件处理结束后、提交前的最后接收检查。 */
  assert_receivable?: () => void;
}

/** 持久化附件并构造可交给唯一 Writer 的 Inbox 内容。 */
export async function prepare_session_prompt_inbox(
  input: PrepareSessionPromptInboxInput,
  attachment_store: SessionAttachmentStore,
): Promise<SessionInboxInput> {
  input.assert_receivable?.();
  const query = input.prompt.query;
  const parts = typeof query === "string"
    ? [{ type: "text" as const, text: query.trim() }]
    : await persist_user_prompt_file_parts(query, attachment_store);
  let source_turn_id: string | undefined;
  const model_parts: SessionModelUserContent[] = [];
  let kind = input.prompt.actor.kind === "runtime" ? input.prompt.actor.namespace : "session_input";
  let context_kind_selected = false;
  for (const part of parts) {
    if (part.type === "data") continue;
    if (part.type === "context" && part.tag === "background_source") {
      const source: unknown = JSON.parse(part.context);
      if (source && typeof source === "object" && "caller_turn_id" in source && typeof source.caller_turn_id === "string") {
        source_turn_id = source.caller_turn_id;
      }
      continue;
    }
    if (part.type === "context" && !context_kind_selected) {
      kind = part.tag;
      context_kind_selected = true;
    }
    model_parts.push(part);
  }
  input.assert_receivable?.();
  return {
    inbox_id: input.inbox_id,
    kind,
    ...(source_turn_id ? { source: { turn_id: source_turn_id } } : {}),
    content: normalize_inbox_content(model_parts),
    meta: build_session_message_meta(input.prompt),
  };
}

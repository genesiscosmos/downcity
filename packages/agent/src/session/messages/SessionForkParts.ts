/**
 * Fork 中 Inbox Part 的复制规则。
 *
 * inbox_id 在每个 Session 的独立数据库内唯一，复制时保留以标识同一条来源事实。
 * source 保留原始因果引用；meta 中的 actor、Powers 和 callback 属于源请求，不能在
 * 目标 Session 中重新获得执行权。承载 Message 的 origin 由导入边界写入。
 */
import type { SessionAgentInboxPart } from "@downcity/type";

/** 复制运行时输入的历史内容，不继承源请求的执行记账。 */
export function copy_session_fork_inbox(part: SessionAgentInboxPart): SessionAgentInboxPart {
  const copied = structuredClone(part);
  delete copied.meta;
  return copied;
}

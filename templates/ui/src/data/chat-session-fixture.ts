/**
 * Chat Showcase 使用的 Session SDK JSONL fixture。
 *
 * fixture 保持 Session canonical Message 的顶层字段和 Part 顺序，模板只在读取后
 * 投影为 `@downcity/ui` 的展示协议，不模拟 Agent runtime。
 */

import { session_jsonl_to_chat_messages, type DowncityChatMessage } from "@downcity/ui";

export const chat_session_jsonl_fixture = `
{"message_id":"user:l3Om3sQMRCEAcAQE","session_id":"showcase","turn_id":"turn:showcase","sequence":1,"revision":1,"visibility":"visible","created_at":1785031625093,"updated_at":1785031625093,"role":"user","parts":[{"part_id":"user-text:1","sequence":1,"type":"text","text":"请分析 Genesis Cosmos 的构想和愿景。"}]}
{"message_id":"agent:analysis","session_id":"showcase","turn_id":"turn:showcase","sequence":2,"revision":2,"visibility":"visible","created_at":1785031625200,"updated_at":1785031626200,"role":"agent","state":"done","parts":[{"part_id":"reasoning:1","sequence":1,"type":"reasoning","text":"我会先梳理愿景、产品边界与落地路径。","state":"done"},{"part_id":"tool:1","sequence":2,"type":"tool","tool_call_id":"call:read","tool_name":"read","state":"completed","input":{"file_path":"README.md"},"output":{"success":true,"lines":118}},{"part_id":"text:1","sequence":3,"type":"text","text":"Genesis Cosmos 的核心价值在于把长期愿景转化为可以持续验证的产品系统。","state":"done"}]}
{"message_id":"user:follow-up","session_id":"showcase","turn_id":"turn:follow-up","sequence":3,"revision":1,"visibility":"visible","created_at":1785031627000,"updated_at":1785031627000,"role":"user","parts":[{"part_id":"user-text:2","sequence":1,"type":"text","text":"继续完善对比，并保留完整的工具执行过程。"}]}
{"message_id":"agent:follow-up","session_id":"showcase","turn_id":"turn:follow-up","sequence":4,"revision":2,"visibility":"visible","created_at":1785031627100,"updated_at":1785031628100,"role":"agent","state":"done","parts":[{"part_id":"reasoning:2","sequence":1,"type":"reasoning","text":"我会按 canonical Part 顺序保留推理、工具和正文。","state":"done"},{"part_id":"tool:2","sequence":2,"type":"tool","tool_call_id":"call:compare","tool_name":"read","state":"completed","input":{"file_path":"agent-sdk-comparison.md"},"output":{"success":true,"lines":96}},{"part_id":"text:2","sequence":3,"type":"text","text":"对比已更新，工具过程仍属于同一条 Agent Message。","state":"done"}]}
`.trim();

/** 解析 fixture，并按 Session sequence 生成 ChatPanel 输入。 */
export function create_chat_session_fixture_messages(): DowncityChatMessage[] {
  return session_jsonl_to_chat_messages(chat_session_jsonl_fixture);
}

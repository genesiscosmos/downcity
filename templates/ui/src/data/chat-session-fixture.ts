/**
 * Chat Showcase 使用的 Session SDK JSONL fixture。
 *
 * fixture 保持 Session canonical Message 的顶层字段和 part 顺序，模板只在读取后
 * 投影为 `@downcity/ui` 的展示协议，不模拟 Agent runtime。
 */

import { session_jsonl_to_chat_messages, type DowncityChatMessage } from "@downcity/ui";

/** JSONL fixture 中用于展示的 Session Message 子集。 */
interface SessionFixtureRecord {
  /** Session Message 稳定标识。 */
  message_id: string;
  /** Session 标识。 */
  session_id: string;
  /** Message 在线性历史中的顺序。 */
  sequence: number;
  /** Message 顶层类型。 */
  type: "user" | "assistant" | "action" | "error";
  /** Message 创建时间。 */
  created_at: number;
  /** User 或 Assistant 的结构化 parts。 */
  parts?: Array<Record<string, unknown>>;
  /** Assistant 当前状态。 */
  status?: string;
  /** Error Message 的用户可见正文。 */
  message?: string;
}

export const chat_session_jsonl_fixture = `
{"message_id":"user:l3Om3sQMRCEAcAQE","session_id":"fork-1785031625087-s3Ed0Vfl","turn_id":"turn:Mqagu5j9U06Laxwh","sequence":1,"revision":1,"visibility":"visible","created_at":1785031625093,"updated_at":1785031625093,"type":"user","input_type":"prompt","parts":[{"part_id":"user-text:1","type":"text","text":"<current-status>\\nWorkspace: /Users/wangenius/Documents/content/genesiscosmos\\n</current-status>\\n\\n<user-message>\\n我觉得我们可以通过文档聊天的方式来聊，你把你的观点或者你的回答写成文档的形式。你分析一下 Genesis Cosmos 我的这个构想和愿景。\\n</user-message>","state":"done"}]}
{"message_id":"assistant:pSnXdWF7RUtb7AxcysHgJ:xumAvgXhs-d95z-U","session_id":"pSnXdWF7RUtb7AxcysHgJ","turn_id":"turn:pSnXdWF7RUtb7AxcysHgJ:1786232042900:n1m-Ao","sequence":2,"revision":33717,"visibility":"visible","created_at":1786232044597,"updated_at":1786232470551,"type":"assistant","kind":"normal","status":"completed","parts":[{"part_id":"step:Hubqea7Js1NKGVlV","sequence":1,"type":"step-start"},{"part_id":"reasoning:T5SQB_3yuMwr60nj","sequence":2,"type":"reasoning","text":"The user is asking in Chinese: \"除了这几个agent对比外，添加mastra和downcity的agent sdk的对比。\" Let me first find the existing comparison document, then update it with the canonical Session parts and preserve the complete tool activity history.","state":"done"},{"part_id":"text:l3BQnXApgTZP48Wd","sequence":3,"type":"text","text":"我先查看一下当前工作区中已有的 agent 对比文档，再决定在哪里添加 Mastra 和 Downcity Agent SDK 的对比。","state":"done"},{"part_id":"tool:call_00_hqQCEGRBX0EKpLJ3FOov5379","sequence":4,"type":"tool","tool_call_id":"call_00_hqQCEGRBX0EKpLJ3FOov5379","tool_name":"grep","state":"completed","input_text":"{\\"query\\":\\"agent\\",\\"path\\":\\".\\"}","input":{"query":"agent","path":".","case_sensitive":false,"max_results":100},"output":{"success":true,"match_count":100}},{"part_id":"step:X4ORtutz3wVUwHDZ","sequence":5,"type":"step-start"},{"part_id":"reasoning:xM4ORtutz3wVUwHDZ","sequence":6,"type":"reasoning","text":"总清单已创建。现在总结给用户。","state":"done"},{"part_id":"text:B1Akpzt93p6-fdIS","sequence":7,"type":"text","text":"总清单已创建。全量 20 项方向已经汇总，并保留每条方向的来源、优先级、动作和验收标准。","state":"done"}]}
{"message_id":"user:pSnXdWF7RUtb7AxcysHgJ:next","session_id":"pSnXdWF7RUtb7AxcysHgJ","turn_id":"turn:pSnXdWF7RUtb7AxcysHgJ:1786232042900:n1m-Ao","sequence":3,"revision":1,"visibility":"visible","created_at":1786232500000,"updated_at":1786232500000,"type":"user","input_type":"prompt","parts":[{"part_id":"user-text:next","type":"text","text":"继续完善这份对比，并保留完整的工具执行过程。","state":"done"}]}
{"message_id":"assistant:pSnXdWF7RUtb7AxcysHgJ:next","session_id":"pSnXdWF7RUtb7AxcysHgJ","turn_id":"turn:pSnXdWF7RUtb7AxcysHgJ:1786232042900:n1m-Ao","sequence":4,"revision":22335,"visibility":"visible","created_at":1786232500500,"updated_at":1786232600000,"type":"assistant","kind":"normal","status":"completed","parts":[{"part_id":"step:next","sequence":1,"type":"step-start"},{"part_id":"reasoning:next","sequence":2,"type":"reasoning","text":"我会按 Session SDK 的 canonical 顺序展示 reasoning、tool 和正文，并把工具输入输出保留在 activity 中。","state":"done"},{"part_id":"tool:next","sequence":3,"type":"tool","tool_call_id":"call-next","tool_name":"read","state":"completed","input_text":"{\\"file_path\\":\\"Agent 源码对比：Hermes · Codex CLI · Pi · Downcity\\"}","input":{"file_path":"Agent 源码对比：Hermes · Codex CLI · Pi · Downcity"},"output":{"success":true,"lines":118}},{"part_id":"text:next","sequence":4,"type":"text","text":"已保留完整的 Session message 结构，并按 canonical activity 分组展示。","state":"done"}]}
`.trim();

/** 解析 fixture，并按 Session sequence 生成 ChatPanel 输入。 */
export function create_chat_session_fixture_messages(): DowncityChatMessage[] {
  return session_jsonl_to_chat_messages(chat_session_jsonl_fixture);
}

/**
 * 自动生成文件，请勿手改。
 * 源文件：由同路径 `*.ts.txt` 生成。
 */

// Source: src/chat/channels/qq/PROMPT.direct.ts.txt
const TEXT_MODULE_CONTENT = "# QQ Adapter Instructions (Direct Mode)\n\n## Capability Scope\n\n- Handles message ingress and sending for the official QQ bot gateway over WebSocket.\n- Inbound messages are mapped by the chat plugin runtime to an internal `session_id`, which is randomly assigned and persisted.\n\n## Usage Constraints\n\n- In direct mode, your assistant text output is automatically sent to the current QQ conversation.\n- QQ outbound replies depend on inbound message context such as `chatType` and `message_id`. For cross-conversation sending, use chat plugin actions instead of writing `chat_key` in direct metadata.\n- Group messages are ingested in full by default and do not require an `@` mention.\n- The adapter filters bot self-loop messages and deduplicates inbound messages to avoid \"replying to itself\" loops.\n";

export default TEXT_MODULE_CONTENT;

/**
 * Session 私密变量引用工具。
 *
 * 该模块只识别 `${secrets.name}` 占位符，不执行模板或代码；真实值由 Session
 * Interaction 运行时在 Tool 执行边界展开。
 */

/** 模型使用 Session 私密变量的统一说明；实际隔离由 Runtime 实现。 */
export const SESSION_SECRET_INSTRUCTIONS = [
  "For passwords, API keys or tokens, ask a secret question with a stable snake_case name and a brief purpose. Never request plaintext in ordinary chat or a text question.",
  "Private answers return ${secrets.name}. Reuse that exact reference in subsequent tool data parameters; Runtime resolves it immediately before execution. References are scoped to this Session and lost after release or restart. Ask again if a reference is unavailable.",
  "Never print, inspect, decode or read back the secret to verify it. Return operation status or business results instead.",
  "Do not place references in tool/action selectors, paths, shell commands or executable source. Current built-in support is file-tool data parameters and Shell session_send.input for stdin. Do not invent env/stdin fields absent from the selected tool schema. Private input to non-Shell City Powers is currently unsupported. For Shell passwords, start the command normally, then use session_send.input only when the program accepts standard or interactive input. For project configuration, write to the requested project path. Interpolation inserts text without escaping; use correct JSON/dotenv encoding. Values containing quotes or newlines require a formatter that receives the secret as data, never source-code substitution.",
].join(" ");

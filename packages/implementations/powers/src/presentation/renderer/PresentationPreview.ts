/** Tool JSON 参数前缀的只读预览；只接收完整解码且以换行闭合的 OpenUI 语句。 */
import type { SessionAgentToolPart, SessionPowerContent } from "@downcity/type";
import { parse_presentation_content } from "../OpenUICatalog.js";

/** 读取 JSON 字符串前缀，保留不完整 escape 之前的已确定内容，不补全结构。 */
function read_string(text: string, start: number): { /** 解码值。 */ value: string; /** 消费后的索引。 */ end: number } {
  let index = start + 1;
  let safe_end = index;
  for (; index < text.length; index += 1) {
    if (text[index] === '"') return { value: JSON.parse(text.slice(start, index + 1)), end: index + 1 };
    if (text[index] === "\\") {
      const length = text[index + 1] === "u" ? 6 : 2;
      if (index + length > text.length) break;
      index += length - 1;
    }
    safe_end = index + 1;
  }
  return { value: JSON.parse(text.slice(start, safe_end) + '"'), end: text.length };
}

/** 只读识别根 action 和 args.content，避免用正则误匹配字符串正文。 */
export function preview_presentation_tool(tool: SessionAgentToolPart): SessionPowerContent | null {
  if (tool.tool_name !== "presentation" || !["input-streaming", "ready", "running"].includes(tool.state)) return null;
  const text = tool.input_text ?? JSON.stringify(tool.input ?? {});
  if (text.length > 300 * 1024) return null;
  let depth = 0;
  let key = "";
  let action = "";
  let content = "";
  try {
    for (let index = 0; index < text.length;) {
      const character = text[index];
      if (character === '"') {
        const token = read_string(text, index);
        let next = token.end;
        while (/\s/.test(text[next] ?? "") && next < text.length) next += 1;
        if (text[next] === ":") key = token.value;
        else {
          if (depth === 1 && key === "action") action = token.value;
          if (depth === 2 && key === "content") content = token.value;
          key = "";
        }
        index = token.end;
      } else { if (character === "{") depth += 1; if (character === "}") depth -= 1; index += 1; }
    }
    if (action !== "show") return null;
    const prefix = content.slice(0, content.lastIndexOf("\n") + 1);
    if (!prefix.trim()) return null;
    parse_presentation_content(prefix, false);
    return { type: "power", power_id: "presentation", schema_version: 2, data: { format: "openui-lang", catalog_id: "downcity.presentation.openui.v1", content: prefix }, fallback_text: "正在生成可视化…" };
  } catch { return null; }
}

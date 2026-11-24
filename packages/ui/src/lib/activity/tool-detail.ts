/** canonical 内建工具的可读正文；只在展开时调用，不把结果信封作为文件内容。 */
import type { SessionAgentToolPart } from "@downcity/type";
import type { ActivityReadableDetail } from "../../types/activity-readable";
import { bounded_text, object_value, read_input, redact_private, text_value } from "./activity_detail_shared";

/** 文件与搜索的闭集适配；未知工具由共享组件的普通等宽文本兜底。 */
export function read_tool_detail(part: SessionAgentToolPart): ActivityReadableDetail | undefined {
  const output = object_value(part.output);
  let target = read_input(part, ["file_path", "path"]);
  let text: string | undefined;
  if (part.tool_name === "read") text = text_value(output?.content) || text_value(output?.text) || (typeof part.output === "string" ? part.output : undefined);
  else if (part.tool_name === "write") text = read_input(part, ["content"]);
  else if (part.tool_name === "edit") {
    const input = object_value(part.input);
    const edits = Array.isArray(input?.edits) ? input.edits : [];
    target = "";
    text = edits.map(item => { const edit = object_value(item); return `${text_value(edit?.old_text).split("\n").map(line => `− ${line}`).join("\n")}\n${text_value(edit?.new_text).split("\n").map(line => `+ ${line}`).join("\n")}`; }).join("\n\n");
  } else if (part.tool_name === "grep" && Array.isArray(output?.matches)) {
    target = "";
    text = output.matches.slice(0, 200).map(item => { const match = object_value(item); return `${text_value(match?.file_path) || text_value(match?.path)}${typeof match?.line === "number" ? `:${match.line}` : ""} ${text_value(match?.text) || text_value(match?.line_text)}`.trim(); }).join("\n");
  } else if (part.tool_name === "find" && Array.isArray(output?.files)) {
    target = "";
    text = output.files.slice(0, 200).map(item => typeof item === "string" ? item : text_value(object_value(item)?.path)).join("\n");
  }
  if (text === undefined || !text) return undefined;
  const preview = bounded_text(text);
  return { type: "readable", target, body: { type: "text", text: redact_private(preview) }, facts: preview.length < text.length || output?.truncated === true ? [{ key: "activity.detail.preview_limited" }] : [] };
}

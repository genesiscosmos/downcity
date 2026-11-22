/**
 * 工具错误的确定性可读语义。只读取本次调用已声明的错误码；不递归搜索结果或解释目标状态。
 * 完整原文由宿主从 canonical output 读取，本模块不截取、复制或请求额外数据。
 */
import type { PowerActivityProps, PowerActivityRenderer } from "../types/PowerActivityRenderer.js";
import { is_chinese, record_value, text_value } from "./Activity.js";

/** 明确错误码的中英文说明；未知错误保留所属动作的失败短句。 */
const error_reasons: Readonly<Record<string, readonly [string, string]>> = {
  invalid_path: ["请求的路径无效。", "The requested path is invalid."],
  sandbox_denied: ["当前工作区不允许访问此路径。", "This path is outside the allowed workspace access."],
  file_not_found: ["找不到请求的文件。", "The requested file was not found."],
  path_not_found: ["找不到请求的路径。", "The requested path was not found."],
  not_a_file: ["目标不是可读取的普通文件。", "The target is not a regular file."],
  not_a_directory: ["目标不是目录。", "The target is not a directory."],
  permission_denied: ["没有访问此资源的权限。", "Permission to access this resource was denied."],
  file_exists: ["目标文件已存在。", "The target file already exists."],
  file_too_large: ["文件超出本次操作的大小限制。", "The file exceeds the size limit for this operation."],
  content_too_large: ["提交的内容过大。", "The submitted content is too large."],
  line_too_large: ["文件中的一行超出读取限制。", "A line in the file exceeds the read limit."],
  media_too_large: ["媒体文件超出附件大小限制。", "The media file exceeds the attachment size limit."],
  encoding_error: ["无法按请求的编码或位置读取文件。", "The file could not be read with the requested encoding or position."],
  binary_file: ["此操作需要文本文件。", "This operation requires a text file."],
  no_edits: ["没有提供要应用的修改。", "No edits were provided."],
  too_many_edits: ["一次提交的修改数量过多。", "Too many edits were submitted at once."],
  duplicate_match: ["要替换的文本在文件中出现多次。", "The text to replace occurs multiple times in the file."],
  not_found: ["文件中找不到要替换的文本。", "The text to replace was not found in the file."],
  overlapping_edits: ["提交的修改范围相互重叠。", "The submitted edit ranges overlap."],
  edit_too_large: ["提交的修改超出大小限制。", "The submitted edit exceeds the size limit."],
  invalid_pattern: ["搜索表达式无效。", "The search pattern is invalid."],
  rg_unavailable: ["当前环境无法使用文件搜索工具。", "The file search tool is unavailable in this environment."],
  search_failed: ["文件搜索未能完成。", "The file search could not be completed."],
  aborted: ["本次操作已中止。", "This operation was aborted."],
  ENOENT: ["找不到请求的文件或目录。", "The requested file or directory was not found."],
  EACCES: ["没有访问此资源的权限。", "Permission to access this resource was denied."],
  EPERM: ["当前操作没有获得权限。", "Permission for this operation was denied."],
  EISDIR: ["目标是目录，请选择文件。", "The target is a directory. Select a file."],
  ENOTDIR: ["请求路径中的一项不是目录。", "A component of the requested path is not a directory."],
  ENOSPC: ["存储空间不足。", "There is not enough storage space."],
  ETIMEDOUT: ["操作超时，请稍后重试。", "The operation timed out. Try again later."],
  ECONNREFUSED: ["无法连接目标服务。", "The target service refused the connection."],
  file_changed: ["文件已发生变化，请重新读取后再修改。", "The file changed. Read it again before editing."],
  text_not_found: ["文件中找不到要替换的文本。", "The text to replace was not found in the file."],
  ambiguous_match: ["要替换的文本匹配了多处内容。", "The text to replace matches multiple locations."],
};

/** 仅解释固定错误信封，不读取目标 Session、Task 或记忆中的其他失败。 */
export function activity_error_reason(props: PowerActivityProps, fallback: string): string {
  const output = record_value(props.tool.output);
  const data = record_value(output.data);
  const error = record_value(output.error);
  const data_error = record_value(data.error);
  const code = text_value(output.error_code) || text_value(error.code) || text_value(data.error_code) || text_value(data_error.code);
  const reason = error_reasons[code];
  if (reason) return reason[is_chinese(props.locale) ? 0 : 1];
  return fallback;
}

/** 为 Power 的领域描述补充统一错误协议；仍由领域自己判断业务失败、等待和成功。 */
export function with_activity_error(renderer: PowerActivityRenderer): PowerActivityRenderer {
  return {
    ...renderer,
    describe: props => {
      const description = renderer.describe(props);
      const terminal = props.tool.state === "completed" || props.tool.state === "failed";
      if (!terminal || description.tone !== "failed") return description;
      return { ...description, has_detail: true, error: description.error ?? { reason: activity_error_reason(props, description.title) } };
    },
  };
}

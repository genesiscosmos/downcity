/** 冻结的 v13 协议，仅供离线迁移；不得作为当前 SDK 运行实现。 */
/**
 * Action 结果的无状态披露契约。所有预算按最终 JSON 的 UTF-8 字节计算，原文采用
 * 版本固定的 JSON 缩进或原始文本；分页不改变共享位置，不拆开 Unicode 代理对。
 * 游标绑定引用、格式版本与位置的摘要用于拒绝损坏/错配；授权由 canonical 读取边界负责。
 */
import { createHash } from "node:crypto";
                                                     

/** 模型可见工具结果完整载荷的字节上限。 */
export const RESULT_BYTES = 16_384;
/** 持久化披露格式版本，变更格式必须增加版本。 */
export const DISCLOSURE_VERSION = 1;

/** 将 JSON 值转换为版本固定的稳定阅读文本。 */
export function result_text(value                )         {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** 计算最终载荷大小，包含 JSON 转义和信封。 */
export function result_bytes(value         )         {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** 将内部 UTF-16 边界编码为绑定同一快照的不透明游标。 */
function encode_cursor(result_ref        , offset        )         {
  const payload = `1:${offset}`;
  const checksum = createHash("sha256").update(result_ref).update("\0").update(payload).digest("base64url");
  return Buffer.from(`${payload}:${checksum}`).toString("base64url");
}

/** 校验游标版本、绑定、边界及规范编码，拒绝错配和损坏。 */
function decode_cursor(result_ref        , cursor                    , text        )         {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || cursor.length > 256) throw new Error("result_cursor_invalid");
  const match = /^1:(0|[1-9]\d*):[A-Za-z0-9_-]+$/.exec(Buffer.from(cursor, "base64url").toString());
  const offset = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length || encode_cursor(result_ref, offset) !== cursor
    || (offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1] ) && /[\uDC00-\uDFFF]/.test(text[offset] ))) {
    throw new Error("result_cursor_invalid");
  }
  return offset;
}

/** 在预算单调增长的前缀中查找最大 Unicode 码点边界。 */
function fit_prefix(text        , fits                             )         {
  let low = 0;
  let high = Math.min(text.length, RESULT_BYTES);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    let end = middle;
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ) && /[\uDC00-\uDFFF]/.test(text[end] )) end -= 1;
    if (fits(text.slice(0, end))) low = middle;
    else high = middle - 1;
  }
  if (low < text.length && /[\uD800-\uDBFF]/.test(text[low - 1] ) && /[\uDC00-\uDFFF]/.test(text[low] )) low -= 1;
  return text.slice(0, low);
}

/** 小结果保持业务结构，大结果生成头尾预览；调用者必须先持久化后发布。 */
export function disclose_result(value                , result_ref        , status                        )                 {
  if (result_bytes(value) <= RESULT_BYTES) return value;
  const text = result_text(value);
  let total_characters = 0;
  let total_lines = text === "" ? 0 : 1;
  for (const character of text) {
    total_characters += 1;
    if (character === "\n") total_lines += 1;
  }
  const total_bytes = Buffer.byteLength(text);
  const tail_characters = Array.from(text.slice(-RESULT_BYTES)).slice(-1500);
  const tail_source = tail_characters.reverse().join("");
  const make_packet = (head        , tail        )                 => {
    const omitted_characters = total_characters - Array.from(head).length - Array.from(tail).length;
    return { view: "folded_result", status, result_ref, format: typeof value === "string" ? "text" : "json_text",
      total_bytes, total_lines,
      omitted_characters, preview: `${head}\n……（已折叠 ${omitted_characters} 个字符）……\n${tail}`,
      next_cursor: encode_cursor(result_ref, head.length) };
  };
  // 控制尾部占完整预算约四分之一，给头部与元信息留出确定空间。
  const reverse_text = (item        )         => Array.from(item).reverse().join("");
  const tail = reverse_text(fit_prefix(tail_source, (item) => result_bytes(make_packet("", reverse_text(item))) <= 4500));
  let head = fit_prefix(text, (item) => result_bytes(make_packet(item, tail)) <= RESULT_BYTES);
  const line_end = head.lastIndexOf("\n");
  if (line_end >= head.length / 2) head = head.slice(0, line_end + 1);
  return make_packet(head, tail);
}

/** 读取同一稳定原文的一页；普通行优先保持完整，超长行在安全字符边界分页。 */
export function read_result_page(value                , result_ref        , cursor         , limit = 100)                 {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("result_limit_invalid: expected 1..200");
  const text = result_text(value);
  const start = decode_cursor(result_ref, cursor, text);
  let end = start;
  for (let lines = 0; lines < limit && end < text.length; lines += 1) {
    const newline = text.indexOf("\n", end);
    end = newline < 0 ? text.length : newline + 1;
  }
  const packet = (body        )                 => {
    const next = start + body.length;
    return { view: "result_page", result_ref, format: typeof value === "string" ? "text" : "json_text", text: body,
      next_cursor: next === text.length ? null : encode_cursor(result_ref, next), eof: next === text.length };
  };
  let body = fit_prefix(text.slice(start, end), (item) => result_bytes(packet(item)) <= RESULT_BYTES);
  if (start + body.length < end) {
    const newline = body.lastIndexOf("\n");
    if (newline >= 0) body = body.slice(0, newline + 1);
  }
  if (!body && start < text.length) throw new Error("result_page_budget_exhausted");
  return packet(body);
}

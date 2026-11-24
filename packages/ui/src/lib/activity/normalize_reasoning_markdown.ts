/**
 * 推理展示专用的 Markdown 归一化，不修改 canonical Part 或普通消息正文。
 *
 * 模型会直接拼接 `**标题一****标题二**`。标准 Markdown 将中间的四个星号
 * 当作加粗内容；这里仅在已打开的双星号标题内，将精确的四星号边界拆为段落。
 * 代码围栏、缩进代码、行内代码与转义字符保留原文；尚未闭合的代码也不改写。
 */

/** 只处理正文中的双星号边界；按行重置状态，避免把独立分隔线识别为标题。 */
function separate_adjacent_titles(text: string): string {
  const parts: string[] = [];
  let strong_open = false;
  let copied_offset = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "\n" || character === "\r") { strong_open = false; continue; }
    if (character !== "*") continue;
    let end = index + 1;
    while (text[end] === "*") end += 1;
    const count = end - index;
    if (count === 4 && strong_open) {
      parts.push(text.slice(copied_offset, index), "**\n\n**");
      copied_offset = end;
    } else if (count === 2) {
      strong_open = !strong_open;
    } else {
      strong_open = false;
    }
    index = end - 1;
  }
  parts.push(text.slice(copied_offset));
  return parts.join("");
}

/** 以代码为边界处理推理文本，流式和静态模式共享相同结果。 */
export function normalize_reasoning_markdown(text: string): string {
  // 同字符围栏允许更长的结束标记；未闭合围栏与行内代码保护到输入末尾。
  const code_pattern = /^ {0,3}(`{3,})[^\n]*(?:\n[\s\S]*?(?:^ {0,3}\1`*[^\S\r\n]*\r?$|(?![\s\S]))|$)|^ {0,3}(~{3,})[^\n]*(?:\n[\s\S]*?(?:^ {0,3}\2~*[^\S\r\n]*\r?$|(?![\s\S]))|$)|^(?: {4}|\t)[^\n]*(?:\n|$)|(?<![\\`])(`+)(?!`)[\s\S]*?(?:\3(?!`)|(?![\s\S]))/gm;
  const parts: string[] = [];
  let copied_offset = 0;
  for (const code_match of text.matchAll(code_pattern)) {
    parts.push(separate_adjacent_titles(text.slice(copied_offset, code_match.index)), code_match[0]);
    copied_offset = code_match.index + code_match[0].length;
  }
  parts.push(separate_adjacent_titles(text.slice(copied_offset)));
  return parts.join("");
}

/**
 * Markdown 流式状态上下文。
 *
 * 图表这类重内容在「正在生成」和「已经生成完」两种情况下应该有不同的失败表现：生成中的围栏
 * 本来就可能是半截语法，把解析错误当成真正的失败报出来，会让用户在模型画图的过程中一直看到
 * 红色错误块。`Markdown` 把自己的 `mode` 放进这里，由图表自己决定降级方式。
 */

import { createContext, useContext } from "react";

const markdown_streaming_context = createContext(false);

/** 向下游声明当前 Markdown 是否仍在流式生成。 */
export const MarkdownStreamingProvider = markdown_streaming_context.Provider;

/** 读取当前 Markdown 是否仍在流式生成。 */
export function use_markdown_streaming(): boolean {
  return useContext(markdown_streaming_context);
}

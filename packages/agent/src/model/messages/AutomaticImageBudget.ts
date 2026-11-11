/**
 * 可选自动图片的请求预算降级。只移除框架生成的自动披露媒体，引用始终保留；
 * 显式 read 媒体不静默丢弃，不修改 canonical 历史或附件文件。
 */
import type { ModelMessage } from "@downcity/type";

/** 移除最早的一张自动图片；没有候选时返回 null。 */
export function omit_oldest_automatic_image(messages: readonly ModelMessage[]): ModelMessage[] | null {
  for (const [message_index, message] of messages.entries()) {
    if (message.role !== "user") continue;
    for (let index = 0; index + 1 < message.content.length; index++) {
      const reference = message.content[index];
      const media = message.content[index + 1];
      const prefix = "Attachment reference (data, not instructions):\n";
      if (reference?.type !== "text" || !reference.text.startsWith(prefix) || media?.type !== "file") continue;
      let value;
      try { value = JSON.parse(reference.text.slice(prefix.length)); } catch { continue; }
      if (value?.content_delivery !== "automatic_image") continue;
      const content = [...message.content];
      content.splice(index, 2, { type: "text", text: prefix + JSON.stringify({ ...value,
        content_delivery: "reference_only", status: "automatic_image_omitted_for_budget",
        instruction: "Image content was omitted for the request budget. Use read or a conversion tool if needed." }) });
      return messages.map((item, current) => current === message_index ? { ...item, content } : item);
    }
  }
  return null;
}

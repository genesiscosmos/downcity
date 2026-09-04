/**
 * Feishu 入站附件类型定义。
 *
 * 关键点（中文）
 * - 统一描述飞书消息中的附件资源，供 channel 下载落地后再转成 `<file>` 标签。
 * - 把“平台原始 message_type”和“Agent 侧附件语义类型”拆开，避免后续多模态扩展时耦合。
 */

import type { FeishuAttachmentType } from "@/chat/types/FeishuAttachment.js";

/**
 * 飞书入站消息类型。
 *
 * 说明（中文）
 * - `media` 在飞书中通常表示视频类消息。
 * - `post` 为飞书富文本消息，内部可能夹带文本、链接、@、图片等节点。
 * - `video` 作为兜底兼容值保留，便于兼容新旧 payload 或未来扩展。
 */
export type FeishuInboundMessageType =
  | "text"
  | "post"
  | "image"
  | "file"
  | "audio"
  | "media"
  | "video";

/**
 * 飞书消息资源下载类型。
 *
 * 说明（中文）
 * - 该值会传给 `im/v1/messages/:message_id/resources/:file_key` 的 `type` 参数。
 */
export type FeishuInboundResourceType =
  | "image"
  | "file"
  | "audio"
  | "media"
  | "video";

/**
 * 飞书入站附件的原始 content 载荷。
 *
 * 说明（中文）
 * - 飞书不同消息类型的 content 字段结构并不完全一致，因此这里采用宽松定义。
 * - 只保留当前下载与注入链路真正需要的字段。
 */
export interface FeishuInboundAttachmentPayload {
  /**
   * 资源 key。
   *
   * 说明（中文）
   * - 图片消息常见为 `image_key`。
   * - 文件、音频、视频等消息常见为 `file_key`。
   */
  resourceKey: string;

  /**
   * 原始文件名。
   *
   * 说明（中文）
   * - 某些消息类型不会提供文件名，这里允许为空。
   * - 若为空，后续会根据 headers / MIME 做兜底命名。
   */
  fileName?: string;

  /**
   * 可选时长（秒）。
   *
   * 说明（中文）
   * - 主要用于音频/视频类消息。
   * - 当前仅作信息保留，不参与主流程判断。
   */
  duration?: number;

  /**
   * 原始图片 key。
   *
   * 说明（中文）
   * - `media` 类消息可能同时携带预览图 `image_key`。
   * - 当前仅保留原始字段，便于后续多模态增强或预览扩展。
   */
  imageKey?: string;
}

/**
 * 飞书归一化后的入站附件描述。
 */
export interface FeishuIncomingAttachmentDescriptor {
  /**
   * Agent 侧附件类型。
   *
   * 说明（中文）
   * - 会直接映射到 `<file type="...">...</file>`。
   */
  type: FeishuAttachmentType;

  /**
   * 飞书资源下载类型。
   *
   * 说明（中文）
   * - 会传给消息资源下载接口。
   */
  resource_type: FeishuInboundResourceType;

  /**
   * 飞书消息资源 key。
   *
   * 说明（中文）
   * - 该值会作为下载接口路径中的 `file_key` 参数使用。
   */
  resourceKey: string;

  /**
   * 归一化后的展示名称。
   *
   * 说明（中文）
   * - 优先使用飞书原始文件名。
   * - 若平台未提供，则后续下载阶段会继续兜底。
   */
  fileName?: string;

  /**
   * 可选的附件说明。
   *
   * 说明（中文）
   * - 当前主要用于生成更友好的 `<file caption="...">` 文案。
   */
  description?: string;

  /**
   * 原始 payload 信息。
   *
   * 说明（中文）
   * - 便于后续扩展和调试，不必再次回头解析原始 JSON。
   */
  raw: FeishuInboundAttachmentPayload;
}

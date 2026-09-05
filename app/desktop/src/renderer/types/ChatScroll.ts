/** Desktop Chat 消息滚动与历史前插锚点类型。 */

/** 判断消息面板是否仍贴近底部所需的滚动几何信息。 */
export interface ChatScrollMetrics {
  /** 滚动内容的完整高度，单位为 CSS 像素。 */
  scroll_height: number;
  /** 消息面板当前纵向滚动位置，单位为 CSS 像素。 */
  scroll_top: number;
  /** 消息面板当前可见高度，单位为 CSS 像素。 */
  client_height: number;
}

/** 加载更早消息前捕获的首个可见消息锚点。 */
export interface ChatPrependAnchor {
  /** 用于在历史前插后重新定位同一消息行的稳定标识。 */
  row_id: string;
  /** 消息行顶部相对滚动容器顶部的原始偏移，单位为 CSS 像素。 */
  viewport_offset: number;
  /** 无法重新找到消息行时用于降级补偿的原始内容高度。 */
  scroll_height: number;
  /** 无法重新找到消息行时需要保留的原始滚动位置。 */
  scroll_top: number;
}

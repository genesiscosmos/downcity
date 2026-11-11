/** 原生图片与文本拆分后的本地预算指标，不代表 Provider usage。 */
export interface RequestTokenEstimate {
  /** 文本协议及普通载荷的 token 估算，不包含图片视觉估算。 */
  text_estimated_tokens: number;
  /** 原生图片的非零视觉 token 估算总量。 */
  image_estimated_tokens: number;
  /** 参与视觉估算的原生图片数，包含工具结果中的图片。 */
  image_count: number;
  /** 所有原生 Base64 媒体的编码字节数，包括图片传输载荷。 */
  media_encoded_bytes: number;
}

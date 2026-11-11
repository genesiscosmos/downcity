/**
 * 原生图片的尺寸解析和本地保守 token 估算，不解压像素、不下载、不依赖 Provider 名称。
 * 文件字节用于传输限制；视觉估算按 512 像素区块，未知尺寸仍有非零预留。
 * 该启发式不是 Provider 计费公式，也不承诺覆盖任意模型的严格上界。
 */

/** 读取图片尺寸最多扫描 256 KiB 文件头，限制 JPEG 标记扫描成本。 */
export const image_header_bytes = 256 * 1024;
/** 未知尺寸或远程图片的保守 token 预留。 */
export const unknown_image_tokens = 32_768;

/** 已验证的图片像素尺寸；仅从真实文件头派生，不接受上传者提供的元信息。 */
export interface ImageDimensions {
  /** 原始图片宽度，单位像素，必须为正整数。 */
  width: number;
  /** 原始图片高度，单位像素，必须为正整数。 */
  height: number;
}

/** 尺寸异常时使用最大安全整数，确保最终预算拒绝而不是溢出为零。 */
export function estimate_image_tokens(dimensions?: ImageDimensions): number {
  if (!dimensions) return unknown_image_tokens;
  const { width, height } = dimensions;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return Number.MAX_SAFE_INTEGER;
  const estimated = Math.ceil(width / 512) * Math.ceil(height / 512) * 1024 + 2048;
  return Number.isSafeInteger(estimated) ? Math.max(8192, estimated) : Number.MAX_SAFE_INTEGER;
}

/** 从 PNG、JPEG、WebP 有限头部读取尺寸；不完整或未知格式返回 undefined。 */
export function read_image_dimensions(input: Uint8Array): ImageDimensions | undefined {
  const bytes = input.subarray(0, image_header_bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, value: string): boolean => offset + value.length <= bytes.length
    && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  const dimensions = (width: number, height: number): ImageDimensions | undefined => width > 0 && height > 0 ? { width, height } : undefined;
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, "PNG\r\n\x1a\n")
    && view.getUint32(8) === 13 && ascii(12, "IHDR")) return dimensions(view.getUint32(16), view.getUint32(20));
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 255) return undefined;
      while (bytes[offset] === 255) offset++;
      if (offset >= bytes.length) return undefined;
      const marker = bytes[offset++]!;
      if (marker === 217 || marker === 218) return undefined;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) return undefined;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return undefined;
      const sof = marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204;
      if (sof) return length >= 8 ? dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)) : undefined;
      offset += length;
    }
  }
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    let offset = 12;
    const uint24 = (start: number): number => bytes[start]! | (bytes[start + 1]! << 8) | (bytes[start + 2]! << 16);
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset + 4, true);
      const data = offset + 8;
      if (data + length > bytes.length) {
        // 大像素块不必完整读入，只需要固定头部。
        if (!(ascii(offset, "VP8 ") || ascii(offset, "VP8L"))) return undefined;
      }
      if (ascii(offset, "VP8X") && length >= 10 && data + 10 <= bytes.length) return dimensions(uint24(data + 4) + 1, uint24(data + 7) + 1);
      if (ascii(offset, "VP8 ") && length >= 10 && data + 10 <= bytes.length && bytes[data]! % 2 === 0
        && bytes[data + 3] === 157 && bytes[data + 4] === 1 && bytes[data + 5] === 42) {
        return dimensions(view.getUint16(data + 6, true) & 16383, view.getUint16(data + 8, true) & 16383);
      }
      if (ascii(offset, "VP8L") && length >= 5 && data + 5 <= bytes.length && bytes[data] === 47) {
        const bits = view.getUint32(data + 1, true);
        return dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
      }
      offset += 8 + length + length % 2;
    }
  }
  return undefined;
}

/**
 * 上传图片自动披露的文件签名白名单。仅检查已受大小限制的字节，不下载、转码或执行内容。
 * PNG / WebP 的动画标记必须按真实块边界解析，不能在像素压缩内容中搜索字符串。
 */

/** 有限文件头筛选；避免为未知 MIME 的 JSON 或二进制加载正文。 */
export function is_automatic_image_header(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
}

/** 返回可自动披露的静态图片类型；不完整块、动画和未知格式返回 undefined。 */
export function automatic_image_type(bytes: Buffer): string | undefined {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8;
    let header = false;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (offset + 12 + size > bytes.length || kind === "acTL") return undefined;
      if (!header) {
        if (kind !== "IHDR" || size !== 13) return undefined;
        header = true;
      }
      if (kind === "IEND") return size === 0 && header ? "image/png" : undefined;
      offset += 12 + size;
    }
    return undefined;
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) {
    let offset = 12;
    let image = false;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      if (offset + 8 + size > bytes.length || kind === "ANIM" || kind === "ANMF") return undefined;
      if (kind === "VP8X" && (size < 10 || (bytes[offset + 8]! & 2) !== 0)) return undefined;
      if (kind === "VP8 " || kind === "VP8L") image = size > 0;
      offset += 8 + size + size % 2;
    }
    return offset === bytes.length && image ? "image/webp" : undefined;
  }
  return undefined;
}

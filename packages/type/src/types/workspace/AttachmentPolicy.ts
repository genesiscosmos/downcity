/** 小静态图片自动披露与显式文件读取共用的媒体载荷上限。 */

/** 单张自动图片或一次显式读取允许披露的原始媒体字节数。 */
export const max_explicit_media_bytes = 2 * 1024 * 1024;
/** 同一请求保留媒体与本 Step 并发读取媒体的原始总字节上限。 */
export const max_request_media_bytes = 4 * 1024 * 1024;

/** 文件元信息版本；媒体披露与文本续读共用，禁止将其称为内容哈希。 */
export function file_read_version(metadata: {
  /** 普通文件字节大小。 */
  size: number;
  /** 最后修改时间，毫秒。 */
  mtimeMs: number;
  /** inode 元信息变更时间，毫秒。 */
  ctimeMs: number;
  /** 文件所在设备中的 inode。 */
  ino: number;
  /** 文件所在设备编号。 */
  dev: number;
}): string {
  return `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
}

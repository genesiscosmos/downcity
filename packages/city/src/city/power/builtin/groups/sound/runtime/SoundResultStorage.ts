/**
 * TTS 标准媒体消息的本地落地。
 * 远端 URL 与内联音频通过 PowerContext.storage.files 写入当前 Power 私有目录，结果只含本地路径；
 * 下载、大小校验或写入失败立即报错，不把远端 URL/base64 伪装为本地文件。
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { outbound_http_fetch } from "@/http/OutboundHttp.js";
import type { PowerContext } from "@/power/types/PowerContext.js";
import type { SoundTtsOutput, SoundTtsResult } from "../types/Sound.js";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/wav": ".wav",
  "audio/x-wav": ".wav", "audio/ogg": ".ogg", "audio/opus": ".opus",
  "audio/mp4": ".m4a", "audio/flac": ".flac", "audio/aac": ".aac",
};

/** 流式读取并限制下载体积；取消信号传入 fetch，正文读取失败向上抛出。 */
async function read_audio_response(response: Response): Promise<Buffer> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Audio download failed (HTTP ${response.status})`); }
  if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) {
    await response.body?.cancel(); throw new Error("Audio result exceeds 50 MiB");
  }
  if (!response.body) throw new Error("Audio result body is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_AUDIO_BYTES) { await reader.cancel(); throw new Error("Audio result exceeds 50 MiB"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new Error("Audio result body is empty");
  return Buffer.concat(chunks, total);
}

/** 将每个音频 part 存为稳定的私有文件；不信任远端本地路径或文件名作为宿主路径。 */
export async function localize_sound_result(context: PowerContext, result: SoundTtsResult): Promise<SoundTtsOutput> {
  const files: string[] = [];
  for (const part of result.parts) {
    if (part.type !== "file" || !part.media_type?.startsWith("audio/")) continue;
    context.abort_signal?.throwIfAborted();
    const source = part.url;
    if (typeof source !== "string" || !source) throw new Error("Audio result URL is missing");
    let bytes: Buffer;
    if (source.startsWith("data:")) {
      const match = /^data:audio\/[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(source);
      if (!match) throw new Error("Audio result must use a base64 audio data URL");
      if (match[1]!.length * 3 / 4 > MAX_AUDIO_BYTES) throw new Error("Audio result exceeds 50 MiB");
      bytes = Buffer.from(match[1]!, "base64");
    } else if (/^https?:\/\//u.test(source)) {
      bytes = await read_audio_response(await outbound_http_fetch(source, { signal: context.abort_signal }));
    } else {
      throw new Error("Audio result must provide an HTTP(S) or data URL");
    }
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("Audio result size is invalid");
    context.abort_signal?.throwIfAborted();
    const digest = createHash("sha256").update(bytes).digest("hex");
    const extension = AUDIO_EXTENSIONS[part.media_type.toLowerCase()] ?? ".bin";
    const absolute_path = context.storage.files.resolve_path("sound", "results", `${digest}${extension}`);
    await context.storage.files.ensure_directory(path.dirname(absolute_path));
    await context.storage.files.write_file_atomically(absolute_path, bytes);
    files.push(absolute_path);
  }
  return { files };
}

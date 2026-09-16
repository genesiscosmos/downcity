/**
 * Sound capability 的输入归一化与结果校验。
 *
 * 关键点（中文）
 * - 模型只提交公开输入，本模块负责校验并转成可直接发给语音服务的形状。
 * - 本地音频以当前 Workspace 为根读取，并在进入语音服务前转换成 data URL。
 * - TTS 结果必须已经落盘：不允许 data URL 或远程地址，避免 Session 持有不可回收的引用。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PluginJsonObject, PluginJsonValue } from "@/plugin/index.js";
import type {
  SoundAsrInput,
  SoundAsrResult,
  SoundAsrSegment,
  SoundCapabilityKind,
  SoundModel,
  SoundModelsResult,
  SoundTtsInput,
  SoundTtsResult,
} from "@/capabilities/sound/types/Sound.js";

const DEFAULT_AUDIO_MEDIA_TYPE = "audio/mpeg";

const AUDIO_MEDIA_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

/** 判断值是否为普通对象。 */
export function to_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 归一化可选字符串。 */
export function normalize_optional_string(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

/** 把异常描述为字符串，并保留有限深度的 cause 诊断链。 */
export function describe_error(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [error.message || error.name || "Error"];
  let current_error: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;
  while (current_error && depth < 3) {
    if (current_error instanceof Error) {
      const code = (current_error as { code?: unknown }).code;
      const code_text = typeof code === "string" && code ? `[${code}] ` : "";
      parts.push(`${code_text}${current_error.message || current_error.name}`.trim());
      current_error = (current_error as { cause?: unknown }).cause;
    } else {
      parts.push(String(current_error));
      break;
    }
    depth += 1;
  }
  return parts.filter(Boolean).join(" :: ");
}

/** 归一化模型筛选输入。 */
export function normalize_models_input(
  payload: PluginJsonValue | undefined,
): SoundCapabilityKind | undefined {
  const record = to_record(payload ?? {});
  if (!record) throw new TypeError("sound_models input must be an object");
  const capability = normalize_optional_string(record.capability);
  if (!capability) return undefined;
  if (capability !== "asr" && capability !== "tts") {
    throw new TypeError("sound_models capability must be asr or tts");
  }
  return capability;
}

/** 归一化 ASR 输入。 */
export function normalize_asr_input(payload: PluginJsonValue | undefined): SoundAsrInput {
  const record = to_record(payload ?? {});
  if (!record) throw new TypeError("asr input must be an object");
  const audio_path = normalize_optional_string(record.audio_path);
  const url = normalize_optional_string(record.url);
  const data_url = normalize_optional_string(record.data_url);
  const source_count = [audio_path, url, data_url].filter(Boolean).length;
  if (source_count !== 1) {
    throw new TypeError("asr requires exactly one of audio_path, url, or data_url");
  }
  return {
    ...(record as SoundAsrInput),
    ...(audio_path ? { audio_path } : {}),
    ...(url ? { url } : {}),
    ...(data_url ? { data_url } : {}),
  };
}

/** 归一化 TTS 输入。 */
export function normalize_tts_input(payload: PluginJsonValue | undefined): SoundTtsInput {
  const record = to_record(payload ?? {});
  if (!record) throw new TypeError("tts input must be an object");
  const text = normalize_optional_string(record.text);
  if (!text) throw new TypeError("tts requires text");
  return { ...(record as unknown as SoundTtsInput), text };
}

/** 推断本地音频 MIME 类型。 */
function infer_audio_media_type(file_path: string, fallback?: string): string {
  const normalized_fallback = normalize_optional_string(fallback);
  if (normalized_fallback) return normalized_fallback;
  return AUDIO_MEDIA_TYPES[path.extname(file_path).toLowerCase()] ?? DEFAULT_AUDIO_MEDIA_TYPE;
}

/** 把本地音频读取为语音服务可直接接收的 data URL。 */
export async function local_audio_to_data_url(input: {
  /** 当前 Workspace 的绝对根目录。 */
  workspace_path: string;
  /** 音频绝对路径或相对 Workspace 的路径。 */
  audio_path: string;
  /** 调用方显式提供的 MIME 类型。 */
  media_type?: string;
}): Promise<{ data_url: string; media_type: string; filename: string }> {
  const file_path = path.isAbsolute(input.audio_path)
    ? path.resolve(input.audio_path)
    : path.resolve(input.workspace_path, input.audio_path);
  const media_type = infer_audio_media_type(file_path, input.media_type);
  const bytes = await fs.readFile(file_path);
  return {
    data_url: `data:${media_type};base64,${bytes.toString("base64")}`,
    media_type,
    filename: path.basename(file_path),
  };
}

/** 把公开 ASR 输入解析为可直接发给语音服务的输入。 */
export async function resolve_asr_input(input: {
  /** 当前 Workspace 的绝对根目录。 */
  workspace_path: string;
  /** 归一化后的公开输入。 */
  payload: SoundAsrInput;
}): Promise<SoundAsrInput> {
  if (!input.payload.audio_path) return input.payload;
  const local = await local_audio_to_data_url({
    workspace_path: input.workspace_path,
    audio_path: input.payload.audio_path,
    media_type: input.payload.media_type,
  });
  const { audio_path: _audio_path, ...rest } = input.payload;
  return {
    ...rest,
    data_url: local.data_url,
    media_type: local.media_type,
    filename: normalize_optional_string(input.payload.filename) ?? local.filename,
  };
}

/** 归一化 JSON 对象。 */
function normalize_json_object(value: unknown): PluginJsonObject | undefined {
  const record = to_record(value);
  return record ? record as PluginJsonObject : undefined;
}

/** 归一化单个语音模型。 */
function normalize_sound_model(value: SoundModel): SoundModel | null {
  const record = to_record(value);
  if (!record) return null;
  const id = normalize_optional_string(record.id);
  if (!id) return null;
  const modalities = Array.isArray(record.modalities)
    ? record.modalities
      .map((item) => normalize_optional_string(item))
      .filter((item): item is string => Boolean(item))
    : [];
  if (!modalities.includes("asr") && !modalities.includes("tts")) return null;
  const tags = Array.isArray(record.tags)
    ? record.tags
      .map((item) => normalize_optional_string(item))
      .filter((item): item is string => Boolean(item))
    : undefined;
  const meta = normalize_json_object(record.meta);
  return {
    id,
    name: normalize_optional_string(record.name) ?? id,
    ...(normalize_optional_string(record.description)
      ? { description: normalize_optional_string(record.description) }
      : {}),
    modalities,
    ...(tags?.length ? { tags } : {}),
    ...(meta ? { meta } : {}),
  };
}

/** 归一化并筛选语音模型列表。 */
export function normalize_sound_models(
  values: SoundModel[],
  capability?: SoundCapabilityKind,
): SoundModelsResult {
  const items = values
    .map((item) => normalize_sound_model(item))
    .filter((item): item is SoundModel => item !== null)
    .filter((item) => !capability || item.modalities.includes(capability));
  return { items };
}

/** 校验并归一化单个 ASR 分段。 */
function normalize_asr_segment(value: unknown): SoundAsrSegment | null {
  const record = to_record(value);
  if (!record) return null;
  const text = normalize_optional_string(record.text);
  if (!text) return null;
  const start_second = Number(record.startSecond);
  const end_second = Number(record.endSecond);
  if (!Number.isFinite(start_second) || !Number.isFinite(end_second)) return null;
  return { text, startSecond: start_second, endSecond: end_second };
}

/** 校验并归一化 ASR 结果。 */
export function normalize_asr_result(result: SoundAsrResult): SoundAsrResult {
  const record = to_record(result);
  const text = normalize_optional_string(record?.text);
  if (!record || !text) {
    throw new TypeError("sound provider asr must return transcription text");
  }
  const segments = Array.isArray(record.segments)
    ? record.segments
      .map((item) => normalize_asr_segment(item))
      .filter((item): item is SoundAsrSegment => item !== null)
    : undefined;
  const language = normalize_optional_string(record.language);
  const duration_in_seconds = Number(record.durationInSeconds);
  return {
    text,
    ...(segments ? { segments } : {}),
    ...(language ? { language } : {}),
    ...(Number.isFinite(duration_in_seconds) && duration_in_seconds >= 0
      ? { durationInSeconds: duration_in_seconds }
      : {}),
  };
}

/** 校验 TTS 返回的 Session 消息已经落盘为本地音频。 */
export function normalize_tts_result(result: SoundTtsResult): SoundTtsResult {
  const record = to_record(result);
  if (!record || !Array.isArray(record.parts)) {
    throw new TypeError("sound provider tts must return a Downcity Session message");
  }
  if (record.role !== "agent") {
    throw new TypeError("sound provider tts must return an Agent Session message");
  }
  const has_audio_file = record.parts.some((part) => {
    const part_record = to_record(part);
    return part_record?.type === "file"
      && typeof part_record.media_type === "string"
      && part_record.media_type.startsWith("audio/");
  });
  if (!has_audio_file) {
    throw new TypeError("sound provider tts Session message must contain an audio file part");
  }
  for (const part of record.parts) {
    const part_record = to_record(part);
    if (part_record?.type !== "file") continue;
    const url = String(part_record.url || "").trim();
    if (!url || url.startsWith("data:") || /^https?:\/\//i.test(url)) {
      throw new TypeError("sound provider tts file parts must be saved locally before returning");
    }
  }
  return result;
}

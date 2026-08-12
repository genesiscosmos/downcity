/**
 * City Language Model Transport JSON 编解码模块。
 *
 * LanguageModelV3 中的 URL、Uint8Array 和 Date 不是普通 JSON 值。本模块使用
 * 明确标签完成无损转换，并拒绝函数、symbol、bigint 和未知 class 实例。
 */

import type {
  CityTransportJsonObject,
  CityTransportJsonValue,
} from "../types/AITransport.js";

const TYPE_FIELD = "__downcity_transport_type";

/** 把 LanguageModelV3 值编码成 transport JSON。 */
export function encode_city_transport_value(value: unknown): CityTransportJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("City transport does not support non-finite numbers");
    return value;
  }
  if (value instanceof URL) return { [TYPE_FIELD]: "url", value: value.toString() };
  if (value instanceof Uint8Array) return { [TYPE_FIELD]: "bytes", value: encode_base64(value) };
  if (value instanceof Date) return { [TYPE_FIELD]: "date", value: value.toISOString() };
  if (value instanceof Error) {
    const details = value as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      retryable?: unknown;
    };
    return {
      [TYPE_FIELD]: "error",
      name: value.name,
      message: value.message,
      ...(typeof details.code === "string" ? { code: details.code } : {}),
      ...(typeof (details.status ?? details.statusCode) === "number"
        ? { status: Number(details.status ?? details.statusCode) }
        : {}),
      ...(typeof details.retryable === "boolean" ? { retryable: details.retryable } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : encode_city_transport_value(item));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("City transport only supports plain objects");
    }
    const output: CityTransportJsonObject = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) output[key] = encode_city_transport_value(item);
    }
    return output;
  }
  throw new TypeError(`City transport does not support ${typeof value}`);
}

/** 把 transport JSON 解码回 LanguageModelV3 可消费的值。 */
export function decode_city_transport_value(value: CityTransportJsonValue): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode_city_transport_value);

  const tagged_type = typeof value[TYPE_FIELD] === "string" ? value[TYPE_FIELD] : undefined;
  const tagged_value = typeof value.value === "string" ? value.value : undefined;
  if (tagged_type === "url" && tagged_value) return new URL(tagged_value);
  if (tagged_type === "bytes" && tagged_value) return decode_base64(tagged_value);
  if (tagged_type === "date" && tagged_value) return new Date(tagged_value);
  if (tagged_type === "error") {
    const error = new Error(typeof value.message === "string" ? value.message : "City model stream error");
    error.name = typeof value.name === "string" ? value.name : "Error";
    const diagnostics = error as Error & { code?: string; status?: number; retryable?: boolean };
    if (typeof value.code === "string") diagnostics.code = value.code;
    if (typeof value.status === "number") diagnostics.status = value.status;
    if (typeof value.retryable === "boolean") diagnostics.retryable = value.retryable;
    return error;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) output[key] = decode_city_transport_value(item);
  return output;
}

/** 断言编码结果是 JSON 对象。 */
export function encode_city_transport_object(value: unknown): CityTransportJsonObject {
  const encoded = encode_city_transport_value(value);
  if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) {
    throw new TypeError("City transport payload must be an object");
  }
  return encoded;
}

/** 将字节数组编码为 Base64。 */
function encode_base64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** 将 Base64 解码为字节数组。 */
function decode_base64(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

/**
 * 二维码 data URL 渲染器。
 *
 * 关键点（中文）
 * - `qrcode-generator` 只在飞书扫码注册真正被使用时才需要，因此按需懒加载。
 * - 渲染结果是可直接放进 `<img src>` 的 data URL，不产生临时文件，也不经过网络。
 */

import { createRequire } from "node:module";

const QRCODE_PACKAGE_NAME = "qrcode-generator";
const QR_ERROR_CORRECTION_LEVEL = "M";
const QR_CELL_SIZE = 6;
const QR_MARGIN_CELLS = 12;
const QRCODE_MISSING_ERROR_CODE = "DOWNCITY_QRCODE_GENERATOR_MISSING";

const require_from_current_module = createRequire(import.meta.url);

/** `qrcode-generator` 暴露的最小工厂能力。 */
interface QrCodeFactory {
  (type_number: number, error_correction_level: string): QrCodeInstance;
}

/** `qrcode-generator` 生成的一个二维码实例。 */
interface QrCodeInstance {
  /** 追加待编码文本。 */
  addData(data: string): void;
  /** 完成编码计算。 */
  make(): void;
  /** 输出图片 data URL。 */
  createDataURL(cell_size: number, margin: number): string;
}

let cached_factory: QrCodeFactory | null = null;

/** 判断错误是否为依赖缺失。 */
function is_missing_module_error(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

/** 构造缺失依赖时的可诊断错误。 */
function create_missing_qrcode_error(cause: unknown): Error {
  const error = new Error(
    `Feishu scan sign-in requires ${QRCODE_PACKAGE_NAME}. Install it before using scan sign-in.`,
  );
  (error as Error & { cause?: unknown; code?: string }).cause = cause;
  (error as Error & { cause?: unknown; code?: string }).code = QRCODE_MISSING_ERROR_CODE;
  return error;
}

/** 懒加载二维码生成器。 */
function load_qrcode_factory(): QrCodeFactory {
  if (cached_factory) return cached_factory;
  try {
    cached_factory = require_from_current_module(QRCODE_PACKAGE_NAME) as QrCodeFactory;
    return cached_factory;
  } catch (error) {
    if (is_missing_module_error(error)) throw create_missing_qrcode_error(error);
    throw error;
  }
}

/** 把文本渲染成可直接放进 `<img src>` 的二维码 data URL。 */
export function render_qr_code_data_url(text: string): string {
  const create_qrcode = load_qrcode_factory();
  const qr_code = create_qrcode(0, QR_ERROR_CORRECTION_LEVEL);
  qr_code.addData(text);
  qr_code.make();
  return qr_code.createDataURL(QR_CELL_SIZE, QR_MARGIN_CELLS);
}

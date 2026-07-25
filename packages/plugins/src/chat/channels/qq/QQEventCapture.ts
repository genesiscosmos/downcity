/**
 * QQEventCapture：QQ 原始网关事件落盘辅助。
 *
 * 关键点（中文）
 * - 只负责“是否捕获”和“如何落盘”，不参与 QQ 主流程路由。
 * - 开启后可帮助排查 QQ 字段缺失、事件结构差异、平台权限差异等问题。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "@downcity/agent";
import type { QQEventCaptureConfig, QQEventCaptureMode, QQGatewayPayload } from "@/chat/channels/qq/types/QqChannel.js";

/**
 * 读取 QQ 原始事件捕获配置。
 */
export function getQqEventCaptureConfig(project_root: string): QQEventCaptureConfig {
  const raw = String(process.env.SHIP_QQ_CAPTURE_EVENTS ?? "")
    .trim()
    .toLowerCase();
  if (!raw || ["0", "false", "off", "no"].includes(raw)) {
    return {
      enabled: false,
      mode: "dispatch",
      dir: join(project_root, ".downcity", ".debug", "qq-events"),
    };
  }

  const mode: QQEventCaptureMode =
    raw === "all" ? "all" : raw === "dispatch" ? "dispatch" : "dispatch";
  const dir =
    typeof process.env.SHIP_QQ_CAPTURE_DIR === "string" &&
    process.env.SHIP_QQ_CAPTURE_DIR.trim()
      ? process.env.SHIP_QQ_CAPTURE_DIR.trim()
      : join(project_root, ".downcity", ".debug", "qq-events");

  return {
    enabled: true,
    mode,
    dir,
  };
}

/**
 * 捕获一条 QQ WebSocket 原始载荷。
 */
export async function captureQqWsPayload(params: {
  config: QQEventCaptureConfig;
  logger: Logger;
  payload: QQGatewayPayload;
}): Promise<void> {
  if (!params.config.enabled) return;
  if (params.config.mode === "dispatch" && params.payload.op !== 0) {
    return;
  }

  try {
    const safeTag = sanitizeFileTag(`${String(params.payload.t ?? "N_A")}`);
    const safeOp = sanitizeFileTag(`${String(params.payload.op ?? "unknown")}`);
    const safeSeq = sanitizeFileTag(`${String(params.payload.s ?? "")}`);
    const filename = `${Date.now()}_${safeOp}_${safeTag}${safeSeq ? `_${safeSeq}` : ""}.json`;

    await mkdir(params.config.dir, { recursive: true });
    await writeFile(
      join(params.config.dir, filename),
      JSON.stringify(
        {
          receivedAt: new Date().toISOString(),
          payload: params.payload,
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch (error) {
    params.logger.debug("QQ event capture failed (ignored)", {
      error: String(error),
    });
  }
}

/**
 * 把任意文本清洗成文件名安全片段。
 */
function sanitizeFileTag(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "N_A";
}

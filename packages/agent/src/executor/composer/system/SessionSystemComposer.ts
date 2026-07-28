/**
 * SessionSystemComposer：Session system messages Composer 抽象。
 *
 * 关键点（中文）
 * - 专职负责“会话上下文 -> system messages”解析。
 * - 与 tools / step 编排解耦，避免 Executor 过载。
 */

import type { SystemModelMessage } from "ai";
import type { SessionComposeInput } from "@/types/session/SessionComposer.js";

/**
 * Session system Composer 协议。
 */
export interface SessionSystemComposer {
  /**
   * 解析器名称（由具体实现声明）。
   */
  readonly name: string;

  /**
   * 解析本轮 system messages。
   */
  resolve(input: SessionComposeInput): Promise<SystemModelMessage[]>;
}

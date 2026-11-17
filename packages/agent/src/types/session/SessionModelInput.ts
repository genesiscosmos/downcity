/** 当前执行栈持有的冻结输入校验与控制检查点；所有内容仅驻留内存。 */
import type { SessionInputMessageVersion } from "../store/SessionInputVersions.js";

/** 原有效输入的进程内内容版本，用于接受 Retry 前校验。 */
export interface SessionModelInputSnapshot {
  /** 完整未修改 ModelCall 的 SHA-256，用于校验内存请求语义。 */
  request_sha256: string;
  /** 输入引用的 canonical 消息身份与内容版本，只驻留当前执行栈。 */
  messages: SessionInputMessageVersion[];
  /** 输入依赖的本地附件，路径来自已登记的 canonical 消息。 */
  attachments: Array<{
    /** Session 已登记的绝对文件路径。 */
    path: string;
    /** 原步骤文件版本（设备、inode、尺寸与时间戳）的摘要；不重复读取或保存文件正文。 */
    sha256: string;
  }>;
}

/** 一个等待手动控制的步骤；运行闭包不持久化，也不充当进程恢复依据。 */
export interface PendingModelRetry {
  /** 当前可恢复的普通错误位置。 */
  binding: import("@downcity/type").SessionModelRetry;
  /** 删除当前错误，成功后才唤醒原执行栈。 */
  clear: () => Promise<void>;
  /** 原 Turn 的取消信号。 */
  signal: AbortSignal;
  /** 接收前校验请求、配置及媒体引用。 */
  validate: () => Promise<void>;
  /** 恢复原请求或进入正常新输入检查点。 */
  resume: (retry: boolean) => void;
  /** 中断等待中的执行。 */
  reject: (error: unknown) => void;
}

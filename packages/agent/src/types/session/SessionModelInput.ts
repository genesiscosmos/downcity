/** 进程内冻结输入校验与新执行描述；所有内容仅驻留内存。 */
import type { SessionInputMessageVersion } from "../store/SessionInputVersions.js";

/** 原有效输入的进程内内容版本，用于接受 Retry 前校验。 */
export interface SessionModelInputSnapshot {
  /** 完整未修改 ModelCall 的 SHA-256，用于校验内存请求语义。 */
  request_sha256: string;
  /** 输入引用的 canonical 消息身份与内容版本，只驻留当前进程。 */
  messages: SessionInputMessageVersion[];
  /** 输入依赖的本地附件，路径来自已登记的 canonical 消息。 */
  attachments: Array<{
    /** Session 已登记的绝对文件路径。 */
    path: string;
    /** 原步骤文件版本（设备、inode、尺寸与时间戳）的摘要；不重复读取或保存文件正文。 */
    sha256: string;
  }>;
}

/** 已结束执行留下的请求描述；不持有 Turn、输出或取消信号。 */
export interface SessionModelReplay {
  /** 普通错误的展示锚点，不是执行身份。 */
  binding: import("@downcity/type").SessionModelRetry;
  /** 失败的完整模型请求，发送时始终复制。 */
  call: import("@downcity/type").ModelCall;
  /** 接收前校验静态配置及原输入引用。 */
  validate: () => Promise<void>;
  /** 为新 Turn 创建工具绑定，不能引用原 Turn。 */
  bind: (context: import("../turn/SessionTurnContext.js").SessionTurnContext) => import("./SessionExecution.js").SessionStepExecutionInput;
}

/** 请求发出前采集的进程内校验能力；不持有执行资源。 */
export interface SessionModelInputValidation {
  /** 当前请求是否仍属于采集时的输入代次。 */
  current: () => boolean;
  /** 校验原消息、附件及静态配置。 */
  validate: () => Promise<void>;
}

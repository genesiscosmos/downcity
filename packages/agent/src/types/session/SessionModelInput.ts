/** 模型步骤输入持久依据；协议快照不含认证信息，媒体只保存引用与摘要。 */
import type { JsonValue } from "@downcity/type";

/** 一个最终请求的可核验持久记录，保存在现有 Session data Part。 */
export interface SessionModelInputSnapshot {
  /** 本快照格式版本。 */
  version: 1;
  /** 与请求尝试共用的模型步骤身份。 */
  step_id: string;
  /** 原任务身份。 */
  turn_id: string;
  /** 已确定的模型身份。 */
  model_id: string;
  /** 完整未修改 ModelCall 的 SHA-256，用于校验内存请求语义。 */
  request_sha256: string;
  /** 经秘密遮罩和媒体引用化后的请求快照，不能直接当作 Provider 输入。 */
  request: JsonValue;
  /** 输入引用的 canonical 消息身份、稳定内容版本；无媒体副本。 */
  messages: Array<{
    /** 所属原始消息。 */
    message_id: string;
    /** 当时已提交 Parts 的内容摘要。 */
    sha256: string;
    /** 原始引用的 Part 身份及内容摘要，用于允许同消息后续追加。 */
    parts: Array<{
      /** 不可变内容身份。 */
      part_id: string;
      /** 该 Part 的内容版本摘要。 */
      sha256: string;
    }>;
  }>;
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
  /** 最后可靠保存的权威尝试聚合。 */
  record: import("@downcity/type").SessionModelRetry;
  /** 持久化同一位置的尝试聚合。 */
  save: (record: import("@downcity/type").SessionModelRetry) => Promise<string>;
  /** 原错误位置所属消息。 */
  message_id: string;
  /** 接收前校验请求、配置及媒体引用。 */
  validate: () => Promise<void>;
  /** 恢复原请求或进入正常新输入检查点。 */
  resume: (retry: boolean) => void;
  /** 中断等待中的执行。 */
  reject: (error: unknown) => void;
}

/** 已可靠保存输入依据的接收检查点。 */
export interface PreparedSessionModelInput {
  /** 当前 Session data Part 的持久身份。 */
  input_part_id: string;
  /** 重新核对原请求、配置、内容引用和附件版本。 */
  validate: () => Promise<void>;
}

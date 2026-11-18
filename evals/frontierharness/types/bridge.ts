/** 独立评测 JSONL 协议与资源边界；不包含 City、Workspace 或宿主工具。 */
import type { ModelUsage } from "@downcity/type";

/** Python 校验后交给 Node 的本轮资源配置。 */
export interface EvalConfig {
  /** 全部模型请求（包括标题、压缩及恢复）的最大 HTTP 尝试数。 */
  max_model_calls: number;
  /** terminal_exec 最大调用次数，包括失败调用。 */
  max_tool_calls: number;
  /** 每次模型请求提交给 Provider 的最大输出 token 数。 */
  max_output_tokens: number;
  /** 每次标准 ModelCall JSON 的 UTF-8 字节上限，不等同于 token 窗口。 */
  max_context_bytes: number;
  /** 单条命令 stdout 与 stderr 各自保留的最大字节数。 */
  max_output_bytes: number;
  /** 单条容器命令允许的最长执行秒数。 */
  command_timeout_sec: number;
  /** 整个 Agent 阶段的适配器墙钟秒数，不含 harness setup/verifier。 */
  run_timeout_sec: number;
  /** 所有终端调用默认使用的容器绝对目录。 */
  cwd: string;
}

/** Python 发出的首帧；日志路径由宿主决定，模型不能指定。 */
export interface InitMessage {
  /** 固定消息判别字段。 */
  type: "init";
  /** 原始任务指令，保留其提交与评分契约。 */
  instruction: string;
  /** 经过 Python 入口校验的固定评测 suite，用于选择来源证据。 */
  suite: "terminal-bench" | "deep-swe";
  /** 当前 suite 唯一固定任务的名称。 */
  task: string;
  /** 显式指定的上游模型名称，不自动剥离 provider 前缀。 */
  model_name: string;
  /** 当前轮不可变资源配置。 */
  config: EvalConfig;
  /** 当前 trial agent 证据的宿主绝对目录。 */
  logs_dir: string;
}

/** 容器终端工具输入。 */
export interface ExecInput {
  /** 只在 harness 当前容器执行的 shell 命令。 */
  command: string;
  /** 容器内绝对目录；省略时采用默认 cwd。 */
  cwd?: string;
  /** 命令时限秒数，不能超过配置上限。 */
  timeout_sec?: number;
}

/** Python 从容器收集并截断的命令结果。 */
export interface ExecResult {
  /** 保留的标准输出，最多 max_output_bytes 个 UTF-8 原始字节。 */
  stdout: string;
  /** 保留的标准错误，最多 max_output_bytes 个 UTF-8 原始字节。 */
  stderr: string;
  /** shell 退出码；超时由容器 wrapper 返回 124。 */
  return_code: number;
  /** 任一输出流是否发生截断。 */
  truncated: boolean;
}

/** 一个真实模型调用的累计 usage；重复 model_usage 覆盖而非求和。 */
export interface CallRecord {
  /** 本 runner 分配的稳定调用序号。 */
  call_id: number;
  /** 当前调用最后收到的完整累计计量，未收到时为 null。 */
  usage: ModelUsage | null;
  /** 是否收到 model_finish，表明最后一份累计计量已经收口。 */
  usage_final: boolean;
  /** 是否已读取到流终点或错误。 */
  settled: boolean;
}

/** 可审计的 usage 汇总；任何一次调用缺失某指标时，该指标为 null。 */
export interface UsageTotals {
  /** 含缓存的全部输入 token；未知为 null。 */
  input_tokens: number | null;
  /** 全部输出 token；未知为 null。 */
  output_tokens: number | null;
  /** 全部缓存命中 token；未知为 null。 */
  cached_input_tokens: number | null;
  /** 全部缓存写入 token；未知为 null。 */
  cache_write_tokens: number | null;
  /** 全部推理 token；未知为 null。 */
  reasoning_tokens: number | null;
}

/** 等待对应 request id 的命令响应。 */
export interface PendingExec {
  /** 在收到同 id 的 exec_result 时兑现。 */
  resolve: (result: ExecResult) => void;
  /** 协议失败、取消或超时时拒绝。 */
  reject: (error: Error) => void;
  /** 清理命令时限与取消监听。 */
  dispose: () => void;
}

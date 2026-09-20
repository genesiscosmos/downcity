/**
 * Sandbox doctor 数据契约。
 *
 * 关键点（中文）
 * - doctor 回答「围栏是否成立」与「宿主工具链是否够用」两个不同问题，两者严重级别不同。
 * - 这里只声明数据结构；探针定义与执行在 `doctor/SandboxDoctor.ts`。
 */

/** 单条探针期望的结果。 */
export type SandboxProbeExpectation =
  /** 探针应当执行成功。 */
  | "succeed"
  /** 探针应当被围栏拒绝。 */
  | "deny";

/**
 * 单条探针失败的严重级别。
 *
 * 关键点（中文）
 * - `fence` 失败说明隔离本身不对，属于必须修的错误。
 * - `environment` 失败说明宿主缺少工具或网络，属于环境提示，不代表围栏坏了。
 */
export type SandboxProbeSeverity =
  /** 围栏正确性。 */
  | "fence"
  /** 宿主环境完整性。 */
  | "environment";

/** 一条 doctor 探针定义。 */
export interface SandboxProbe {
  /** 探针稳定标识。 */
  id: string;
  /** 面向用户的探针说明。 */
  title: string;
  /** 要执行的完整命令。 */
  command: string;
  /** 期望结果。 */
  expectation: SandboxProbeExpectation;
  /** 失败时的严重级别。 */
  severity: SandboxProbeSeverity;
}

/** 一条探针的执行结果。 */
export interface SandboxProbeResult {
  /** 对应探针标识。 */
  probe_id: string;
  /** 面向用户的探针说明。 */
  title: string;
  /** 实际执行的命令。 */
  command: string;
  /** 期望结果。 */
  expectation: SandboxProbeExpectation;
  /** 失败严重级别。 */
  severity: SandboxProbeSeverity;
  /** 进程退出码；无法取得时为 -1。 */
  exit_code: number;
  /** 探针是否符合期望。 */
  ok: boolean;
  /** 输出摘录，用于人工确认。 */
  output_excerpt: string;
  /** 命中拒绝翻译时的可执行解释；未命中为 null。 */
  explanation: string | null;
}

/** 一次 doctor 运行的完整报告。 */
export interface SandboxDoctorReport {
  /** 当前 Provider 后端标识。 */
  backend: string;
  /** Provider 自检结果；围栏不可用时为 false。 */
  provider_ok: boolean;
  /** Provider 自检发现的问题说明。 */
  provider_issues: readonly string[];
  /** 当前隔离环境的稳定身份。 */
  sandbox_id: string;
  /** 当前生效策略摘要，用于审计还原。 */
  policy_digest: string;
  /** 全部探针结果，顺序与探针定义一致。 */
  results: readonly SandboxProbeResult[];
  /** 围栏类探针是否全部符合期望。 */
  fence_ok: boolean;
  /** 环境类探针中未通过的条数。 */
  environment_warnings: number;
}

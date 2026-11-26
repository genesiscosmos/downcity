/** 一次性迁移的显式材料、人工覆盖核对和单 scope 切换协议；不扫描运行目录。 */
import type { MemoryContent, MemoryScope, MemorySource, MemoryState } from "./MemoryRecord.js";
import type { MemoryStorageAdapter } from "./MemoryStorage.js";

/** 调用方显式提供的固定旧材料，不在读取时推断或自动转换。 */
export interface MemoryMigrationMaterial {
  /** 旧对象或原始块的稳定审计身份。 */
  legacy_id: string;
  /** 原始字节对应的完整文本，不进行空行拆分。 */
  original_text: string;
  /** 旧对象是否为完整 Profile 多规则材料。 */
  format: "profile_block" | "knowledge";
  /** 原有效性，墓碑不可重新激活。 */
  state: MemoryState;
  /** 可核实的原始归属；缺失时人工决定。 */
  scope?: MemoryScope;
  /** 历史时间语义与旧字段仅进入审计。 */
  audit: Record<string, unknown>;
  /** 需保留且可核实的原始来源。 */
  sources?: MemorySource[];
  /** 旧自动生效/到期机器行为，存在时阻止新协议切换。 */
  scheduled_validity?: boolean;
}
/** 人工逐条核对后的候选；标题候选不得冒充确定正文。 */
export interface MemoryMigrationCandidate {
  /** 覆盖的一个或多个旧材料身份。 */
  legacy_ids: string[];
  /** 人工确认归属后的完整新内容。 */
  content: MemoryContent;
  /** 退出状态必须延续原墓碑。 */
  state: MemoryState;
  /** 旧稳定 ID 合法时可保留，否则系统确定性分配。 */
  preserve_memory_id?: string;
  /** 人工明确确认完整条件、否定、授权限制和标题已保留。 */
  reviewed: boolean;
  /** 人工核对说明，不补造历史用户原话。 */
  review_note: string;
}
/** 纯预览是可重放的固定审阅材料。 */
export interface MemoryMigrationPreview {
  /** 本次准备切换的唯一归属。 */
  scope: MemoryScope;
  /** 原始材料内容指纹。 */
  input_hash: string;
  /** 人工候选集合。 */
  candidates: MemoryMigrationCandidate[];
  /** 全部原材料快照与历史时间审计。 */
  materials: MemoryMigrationMaterial[];
  /** 逐旧材料的候选覆盖。 */
  coverage: Record<string, number[]>;
  /** 未解决项，非空时不可发布。 */
  blockers: string[];
  /** 旧历史与抑制的完整核对包。 */
  preservation: MemoryMigrationPreservation;
}
/** 切换必须处于明确停写窗口，控制权属于调用迁移工具的可信宿主。 */
export interface MemoryMigrationPublishInput {
  /** 已分配的私有 Store，不允许模型传物理路径。 */
  storage: MemoryStorageAdapter;
  /** 预览对应的内部范围前缀。 */
  scope_prefix: string;
  /** 人工确认的固定预览。 */
  preview: MemoryMigrationPreview;
  /** 人工核对时读取的完整预览指纹。 */
  expected_preview_hash: string;
  /** 显式切换授权，不由后台或启动时自动产生。 */
  authorization: "explicit_management_migration";
  /** 宿主持有整个切换窗口的停写屏障；返回前必须禁止旧 runtime/旧 Job 再写此范围。 */
  with_write_barrier: <T>(publish: () => Promise<T>) => Promise<T>;
  /** 已人工确认为空；不允许将缺材料等价为空。 */
  confirmed_empty?: boolean;
}

/** 旧审计与忘记语义必须完整提供；缺少材料禁止范围切换。 */
export interface MemoryMigrationPreservation {
  /** 调用方核对完整旧账本、manifest 和 Job 后确认，不是模型推断。 */
  complete: boolean;
  /** 固定旧版本、Profile 账本及 Job/历史原文快照，不进入召回。 */
  history_snapshots: { /** 旧材料身份。 */ legacy_id: string; /** 原始完整快照。 */ text: string }[];
  /** 旧更新或忘记产生的全部精确抑制，继续参与新 runtime 防复活。 */
  suppressions: import("./MemoryTransaction.js").MemorySuppression[];
}

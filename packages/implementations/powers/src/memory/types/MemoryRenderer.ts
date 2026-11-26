/** Memory 记录界面的宿主依赖与固定范围。 */
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryKind, MemoryScopeType } from "./MemoryRecord.js";

/** 同一界面只绑定一个真实管理对象和种类。 */
export interface MemoryRecordsViewProps {
  /** 可信宿主 action gateway。 */
  power: PowerMainviewComponentProps["power"];
  /** 现有主题与共享组件。 */
  ui: PowerMainviewComponentProps["ui"];
  /** 数据归属类别。 */
  scope: MemoryScopeType;
  /** 当前视图的内容种类。 */
  kind: MemoryKind;
  /** Agent 私有入口的真实身份。 */
  agent_id?: string;
  /** Workspace 入口的真实项目身份。 */
  workspace_id?: string;
  /** 独立资源 tab 可直接打开一条记录。 */
  initial_memory_id?: string;
}

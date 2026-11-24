/** Tool、Action、Input 与分组摘要共享的活动行契约；正文由各自领域按需构造。 */
import type { ReactNode } from "react";
import type { AgentActivityDiffStat, AgentActivityTone } from "./activity";

/** 不包含交互状态的轻量摘要，组摘要必须使用纯文本身份与目标。 */
export interface ActivityRowSummary {
  /** 来源图标；Input 同时提供接收方向标记。 */
  icon: ReactNode;
  /** 生命周期语气，失败始终使用 destructive。 */
  tone: AgentActivityTone;
  /** 文件改动统计，紧跟路径且不属于路径链接。 */
  diff_stat: AgentActivityDiffStat | null;
  /** 本地化状态文案；Power 可将状态并入身份标题。 */
  state: string;
  /** 主标题或可信文件路径链接。 */
  identity: ReactNode;
  /** 弱化目标；单条 Skill 可提供受控文件按钮。 */
  summary: ReactNode;
  /** 目标的完整可访问文本；React 节点不会自动转为字符串。 */
  summary_text?: string;
  /** 入站结果语义，只影响图标和标题颜色，不绘制容器。 */
  incoming?: boolean;
  /** 可聚焦结果 region 的名称；设置后由共享外壳关联 ID 并提供详情框架。 */
  detail_label?: string;
  /** 按需挂载的领域正文；缺省时不生成折叠入口。 */
  render_body?: () => ReactNode;
}

/** 活动行的显式展示选择与可访问详情能力。 */
export interface ActivityRowProps extends ActivityRowSummary {
  /** 宿主持有的展开状态；省略时由当前挂载实例持有。 */
  open?: boolean;
  /** 展开变化回调；宿主可按完整消息与 Part 身份保存阅读状态。 */
  on_open_change?(open: boolean): void;
  /** 活动组额外记录数；单条 Input 不使用徽标。 */
  badge?: string;
  /** 按需挂载的追加交互区域。 */
  render_extra_body?: () => ReactNode;
  /** 分组摘要附加样式。 */
  summary_class_name?: string;
  /** 是否显示紧跟内容的折叠箭头。 */
  show_chevron?: boolean;
}

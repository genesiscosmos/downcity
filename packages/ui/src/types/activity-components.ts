/** Activity 结构原语：顺序容器、稳定条目、描述头部和唯一详情面板；不解释领域数据。 */
import type { HTMLAttributes, ReactNode } from "react";

/** 有序活动容器；按 children 顺序展示，不重排业务记录。 */
export interface ActivityProps {
  /** 已按业务顺序构造的 ActivityItem。 */
  children: ReactNode;
  /** 宿主位置样式；条目间距由 Activity 持有。 */
  class_name?: string;
}

/** 一个稳定活动条目；头部必需，有详情时才具备展开状态。 */
export interface ActivityItemProps {
  /** 当前容器内稳定的业务身份；更新内容不改变该身份。 */
  item_id: string;
  /** 必需的 ActivityHeader；内容与控件由调用方提供。 */
  header: ReactNode;
  /** 惰性构造正文；省略时不创建面板或折叠入口，收起时不调用。 */
  render_detail?: () => ReactNode;
  /** 惰性构造分组内的活动条目，与 render_detail 互斥；直接展开，不套详情面板。 */
  render_items?: () => ReactNode;
  /** 宿主控制的展开状态；省略时使用条目本地状态。 */
  open?: boolean;
  /** 本地状态的初始展开选择；受控 open 优先。 */
  default_open?: boolean;
  /** 请求改变展开状态；宿主可先确认草稿或保持阅读锚点。 */
  on_open_change?: (open: boolean) => void;
  /** 详情 region 的可访问名称；未提供时引用当前头部。 */
  detail_label?: string;
  /** 条目表面、位置或领域语气样式；不替代面板内容排版。 */
  class_name?: string;
}

/** 描述与展开入口；元信息、导航控件属于 Header，不嵌入详情正文。 */
export interface ActivityHeaderProps {
  /** 标题、图标或领域描述；不会重复生成页面标题。 */
  children: ReactNode;
  /** 可供外部表单引用的描述 DOM ID；省略时由条目生成。 */
  description_id?: string;
  /** 可选来源、时间与状态；省略时不占位。 */
  metadata?: ReactNode;
  /** 描述行尾部控件，例如关闭；点击按钮不触发展开。 */
  trailing?: ReactNode;
  /** 可选导航操作；链接和按钮保留独立点击语义。 */
  actions?: ReactNode;
  /** 是否展示展开箭头；没有详情时始终不展示。 */
  show_chevron?: boolean;
  /** 头部领域样式；紧凑工具描述与 Inbox 可使用不同内容。 */
  class_name?: string;
}

/** 统一限高滚动的详情面板，业务仅提供正文与可访问属性；内层 content 持有留白和默认排版。 */
export interface ActivityDetailPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className"> {
  /** 已解释的正文、表单、附件或错误；由 ActivityItem 展开后挂载。 */
  children: ReactNode;
}

/** Item 向必需 Header 注入的唯一展开事实；不包含领域数据。 */
export interface ActivityItemState {
  /** 当前条目的稳定业务身份。 */
  item_id: string;
  /** 当前是否具备可展开详情。 */
  has_detail: boolean;
  /** 当前受控或本地展开选择。 */
  open: boolean;
  /** Header 的稳定 DOM ID，用于默认详情命名。 */
  header_id: string;
  /** 详情的稳定 DOM ID，用于 aria-controls。 */
  detail_id: string;
  /** 可选的具体结果名称，用于 Header 和 region。 */
  detail_label?: string;
  /** 头部请求翻转状态；确认与持久化由宿主回调决定。 */
  toggle: () => void;
}

/**
 * 首页 SDK 世界滚动叙事的领域类型。
 *
 * 外层区块拥有唯一滚动步骤，地图和代码面板只消费当前步骤，确保两侧始终表达
 * 同一次领域变化，不各自维护动画生命周期。
 */

/** 首页代码面板展示的真实文件。 */
export type HomeSdkFileKey = "agent" | "city" | "federation";

/** SDK 世界地块使用的领域视觉语义。 */
export type HomeSdkWorldCellTone =
  | "workspace"
  | "plugin"
  | "city"
  | "storage"
  | "transport"
  | "link"
  | "federation"
  | "service";

/** SDK 世界地块内部承载的可见内容。 */
export type HomeSdkWorldCellContent =
  | "agent"
  | "agent_workspace"
  | "workspace"
  | "storage"
  | "transport"
  | "user"
  | "none";

/** Plugin 地块用于区分真实内置能力的图标语义。 */
export type HomeSdkWorldPluginKind = "skill" | "task" | "web" | "memory";

/** SDK 世界中用于强调代码所属领域的分组。 */
export type HomeSdkWorldCellGroup = "agent" | "city" | "link" | "federation";

/** SDK 世界中由连续地块共同形成的区域。 */
export type HomeSdkWorldBoundaryKey = "origin_city" | "neighbor_city" | "third_city" | "federation";

/** SDK 世界轴向网格中的单个地块。 */
export interface HomeSdkWorldCell {
  /** 地块在地图中的稳定唯一键。 */
  key: string;
  /** 地块在平顶六边形网格上的 q 轴坐标。 */
  q: number;
  /** 地块在平顶六边形网格上的 row 轴坐标。 */
  row: number;
  /** 地块首次出现的滚动步骤。 */
  visible_step: number;
  /** 地块所属的代码领域，用于随文件切换调整视觉强调。 */
  group: HomeSdkWorldCellGroup;
  /** 地块参与形成的 City 或 Federation 边界；中立连接地块为空。 */
  boundary_key: HomeSdkWorldBoundaryKey | null;
  /** 地块的地图色彩语义。 */
  tone: HomeSdkWorldCellTone;
  /** 地块内部绘制的 Agent 内容类型。 */
  content: HomeSdkWorldCellContent;
  /** 地块内可见概念对应的标签键；无标签时为空。 */
  label_key: keyof HomeSdkWorldLabels | null;
  /** 地块内 Agent 的身份色；无 Agent 时为空。 */
  agent_accent: string | null;
  /** 连接地块继承的 City 身份色；普通地块不设置。 */
  link_accent?: string;
  /** Plugin 地块展示的内置能力图标；非 Plugin 地块不设置。 */
  plugin_kind?: HomeSdkWorldPluginKind;
}

/** SDK 世界区域名称在轴向网格中的锚点。 */
export interface HomeSdkWorldAnnotation {
  /** 标注对应的区域键。 */
  boundary_key: HomeSdkWorldBoundaryKey;
  /** 标注首次出现的滚动步骤。 */
  visible_step: number;
  /** 标注锚点的 q 轴坐标。 */
  q: number;
  /** 标注锚点的 row 轴坐标。 */
  row: number;
  /** 标注相对锚点的水平偏移。 */
  offset_x: number;
  /** 标注相对锚点的垂直偏移。 */
  offset_y: number;
  /** 标注对应的本地化标签键。 */
  label_key: "city" | "neighbor_city" | "third_city" | "federation";
}

/** SDK 世界地图组件的输入参数。 */
export interface HomeSdkWorldMapProps {
  /** 当前滚动叙事步骤，范围为 0 到 21。 */
  active_step: number;
  /** 当前代码文件，用于轻量强调地图中的对应领域。 */
  active_file: HomeSdkFileKey;
  /** 当前语言下用于描述地图内容的无障碍标签。 */
  aria_label: string;
  /** 当前语言下显示在地图中的概念名称。 */
  labels: HomeSdkWorldLabels;
}

/** 地图内所有可见领域概念标签。 */
export interface HomeSdkWorldLabels {
  /** Agent 居民名称。 */ agent: string;
  /** Agent 能力扩展节点名称。 */ plugin: string;
  /** Workspace 地块名称。 */ workspace: string;
  /** Group 主体名称。 */ group: string;
  /** GroupSession 群聊上下文名称。 */ group_session: string;
  /** City 持有的 Storage 名称。 */ storage: string;
  /** City 对外 Transport 名称。 */ transport: string;
  /** 第一座城市名称。 */ city: string;
  /** 第二座城市名称。 */ neighbor_city: string;
  /** 第三座城市名称。 */ third_city: string;
  /** Federation 权威后端名称。 */ federation: string;
  /** Federation 数据库节点名称。 */ database: string;
  /** Federation Service 节点名称。 */ service: string;
  /** Federation AI Model 节点名称。 */ model: string;
  /** Federation Account 节点名称。 */ account: string;
  /** Federation Payment 节点名称。 */ payment: string;
  /** Federation Credits 节点名称。 */ credits: string;
  /** Federation Env 节点名称。 */ env: string;
  /** Federation Usage 节点名称。 */ usage: string;
  /** City 与 Federation 之间的连接地块名称。 */ link: string;
  /** User 消息气泡名称。 */ user: string;
  /** User 发送给 Session 的实际请求文本。 */ user_prompt: string;
  /** User 发送给 GroupSession 的实际请求文本。 */ group_prompt: string;
  /** Agent 通过 Session 返回的示例响应文本。 */ agent_reply: string;
}

/** 首页滚动代码面板的输入参数。 */
export interface HomeSdkCodePanelProps {
  /** 当前滚动叙事步骤，决定文件、可见代码和高亮块。 */ active_step: number;
  /** 当前编辑器选中的文件。 */ active_file: HomeSdkFileKey;
  /** 用户选择已经出现的代码文件时触发的回调。 */ on_file_select: (file_key: HomeSdkFileKey) => void;
  /** 当前界面语言，用于选择代码中的示例文本。 */ locale: "zh" | "en";
  /** 文件标签组的无障碍名称。 */ tabs_label: string;
  /** 当前 SDK 文档入口的路由。 */ docs_path: string;
  /** 当前 SDK 文档入口的链接文字。 */ docs_label: string;
  /** 复制按钮的无障碍标签。 */ copy_label: string;
  /** 复制完成后的状态标签。 */ copied_label: string;
}

/**
 * 首页统一 Hero World 舞台使用的 Ghost 与绘图组件类型。
 *
 * 城市、主角 Agent、Capabilities 与蜂巢大陆共用一个 SVG 坐标系；这里仅声明
 * 各绘图层之间必要的状态和 MotionValue，避免子组件各自管理滚动生命周期。
 */

import type { MotionValue } from "framer-motion";
import type { InterfaceLocale } from "@/types/interface-locale";
import type { HomeProductWorldInspectEvent } from "@/types/home/HomeProductWorld";

/** 可复用 Ghost SVG 图形的输入参数。 */
export interface HomeGhostGlyphProps {
  /** Ghost 在当前 SVG 坐标系中的水平中心。 */
  center_x: number;
  /** Ghost 在当前 SVG 坐标系中的垂直中心。 */
  center_y: number;
  /** Ghost 图形的基准尺寸。 */
  size: number;
  /** Ghost 身体使用的身份色。 */
  accent: string;
  /** 眼睛使用的填充色类名。 */
  eye_class_name?: string;
}

/** Hero 城市正立面绘图层参数。 */
export interface HomeHeroCityStageProps {
  /** 用于生成对应中英文产品文档入口的当前界面语言。 */
  locale: InterfaceLocale;
  /** 整个城市立面随共享滚动进度变化的透明度。 */
  city_opacity: MotionValue<number> | number;
  /** 整个城市立面随共享滚动进度变化的垂直位移。 */
  city_y: MotionValue<number> | number;
  /** 整个城市立面随共享滚动进度变化的缩放值。 */
  city_scale: MotionValue<number> | number;
}

/** Hero 舞台中独立于城市和 Product World 的主角 Ghost 参数。 */
export interface HomeHeroAgentActorProps {
  /** 主角 Ghost 贯穿 Hero 与产品世界的强调色。 */
  accent: string;
  /** 主角随滚动进度变化的水平坐标。 */
  agent_x: MotionValue<number> | number;
  /** 主角随滚动进度变化的垂直坐标。 */
  agent_y: MotionValue<number> | number;
  /** 主角从城市进入产品世界时使用的缩放值。 */
  agent_scale: MotionValue<number> | number;
  /** 主角投影随世界尺度变化的透明度。 */
  shadow_opacity: MotionValue<number> | number;
  /** Hero 与产品世界共享的平滑滚动进度。 */
  scroll_progress: MotionValue<number>;
  /** 能力向主角汇聚时的局部动画进度。 */
  capability_progress: MotionValue<number>;
  /** 是否遵循用户的减少动态效果偏好。 */
  reduce_motion: boolean;
}

/** 单个能力节点的引力汇聚配置。 */
export interface HomeCapabilityNodeDefinition {
  /** 能力的翻译键后缀。 */
  key: string;
  /** 节点的初始水平坐标。 */
  x: number;
  /** 节点的初始垂直坐标。 */
  y: number;
  /** 二次贝塞尔曲线控制点的水平坐标。 */
  curve_x: number;
  /** 二次贝塞尔曲线控制点的垂直坐标。 */
  curve_y: number;
  /** 节点开始被吸引的进度。 */
  absorb_start: number;
  /** 节点完成汇聚的进度。 */
  absorb_end: number;
  /** 节点震动相位。 */
  vibration_phase: number;
  /** 标签相对节点的垂直偏移。 */
  label_offset_y: number;
}

/** 单个能力节点绘图层的参数。 */
export interface HomeCapabilityNodeProps {
  /** 当前节点配置。 */
  node: HomeCapabilityNodeDefinition;
  /** 当前节点显示的中英文标签。 */
  label: string;
  /** 能力与主角共享的强调色。 */
  agent_accent: string;
  /** 能力汇聚进度。 */
  capability_progress: MotionValue<number>;
}

/** 能力汇聚绘图层参数。 */
export interface HomeCapabilityConvergenceLayerProps {
  /** 能力与主角共享的强调色。 */
  agent_accent: string;
  /** 能力汇聚进度。 */
  capability_progress: MotionValue<number>;
}

/** Product World SVG 绘图层参数。 */
export interface HomeProductWorldSectionProps {
  /** 唯一主角 Agent 贯穿产品世界的强调色。 */
  agent_accent: string;
  /** 能力汇聚动画的滚动进度。 */
  capability_progress: MotionValue<number>;
  /** 五组大陆地块依次生长时使用的透明度。 */
  growth_opacities: readonly (MotionValue<number> | number)[];
  /** 五组大陆地块从中心向外展开时使用的逐层缩放值。 */
  growth_scales: readonly (MotionValue<number> | number)[];
  /** 当前被预览或固定的地块键。 */
  active_cell_key: string | null;
  /** 地图是否已展开到可以交互的阶段。 */
  is_interactive: boolean;
  /** 鼠标或键盘预览地块。 */
  on_cell_preview: (event: HomeProductWorldInspectEvent) => void;
  /** 鼠标离开地块时清除预览。 */
  on_cell_preview_end: () => void;
  /** 点击或键盘确认地块。 */
  on_cell_select: (event: HomeProductWorldInspectEvent) => void;
  /** City 真实蜂巢边缘的透明度。 */
  city_boundary_opacity: MotionValue<number> | number;
  /** Federation 真实蜂巢边缘的透明度。 */
  federation_boundary_opacity: MotionValue<number> | number;
  /** Federation 边缘路径的绘制进度。 */
  federation_boundary_path: MotionValue<number> | number;
}

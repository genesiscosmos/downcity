/**
 * 首页统一 Hero World 舞台使用的 Ghost 与绘图组件类型。
 *
 * 城市、主角 Agent、Capabilities 与蜂巢大陆共用一个 SVG 坐标系；这里仅声明
 * 各绘图层之间必要的状态和 MotionValue，避免子组件各自管理滚动生命周期。
 */

import type { MotionValue } from "framer-motion";
import type { InterfaceLocale } from "@/types/interface-locale";

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
  /** 是否遵循用户的减少动态效果偏好。 */
  reduce_motion: boolean;
}

/** Product World SVG 绘图层参数。 */
export interface HomeProductWorldSectionProps {
  /** 唯一主角 Agent 贯穿产品世界的强调色。 */
  agent_accent: string;
  /** Capabilities 节点组的透明度。 */
  capability_opacity: MotionValue<number> | number;
  /** Capabilities 节点组的缩放值。 */
  capability_scale: MotionValue<number> | number;
  /** Capabilities 节点组的旋转角度。 */
  capability_rotate: MotionValue<number> | number;
  /** 能力汇入 Agent 的路径绘制进度。 */
  capability_path: MotionValue<number> | number;
  /** 能力集成环的透明度。 */
  integration_ring_opacity: MotionValue<number> | number;
  /** 能力集成环的缩放值。 */
  integration_ring_scale: MotionValue<number> | number;
  /** 五组大陆地块依次生长时使用的透明度。 */
  growth_opacities: readonly (MotionValue<number> | number)[];
  /** 五组大陆地块从中心连续扩张时使用的缩放值。 */
  growth_scales: readonly (MotionValue<number> | number)[];
  /** City 真实蜂巢边缘的透明度。 */
  city_boundary_opacity: MotionValue<number> | number;
  /** Federation 真实蜂巢边缘的透明度。 */
  federation_boundary_opacity: MotionValue<number> | number;
  /** Federation 边缘路径的绘制进度。 */
  federation_boundary_path: MotionValue<number> | number;
}

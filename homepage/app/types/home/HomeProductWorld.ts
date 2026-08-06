/**
 * 首页 Product World 地图的领域类型。
 *
 * 地图数据、标注和检查卡共享这些最小类型，绘图层不需要知道布局生成的细节。
 */

import type { MotionValue } from "framer-motion";

/** 地图地块的地形类型。 */
export type HomeProductWorldTerrainKind = "land" | "water" | "wilderness";

/** 地块内部可见内容的类型。 */
export type HomeProductWorldContentKind =
  | "agent"
  | "forest"
  | "building"
  | "workshop"
  | "plaza"
  | "water"
  | "empty";

/** 可被用户检查的命名地貌。 */
export type HomeProductWorldFeatureKey =
  | "memory_lake"
  | "mirror_lake"
  | "model_strait"
  | "quiet_wilds";

/** 地图标注的语义类型。 */
export type HomeProductWorldAnnotationKind = "federation" | "feature" | "city";

/** Product World 中的单个六边形地块。 */
export interface HomeProductWorldCell {
  /** 地块在 SVG 网格中的唯一键。 */
  key: string;
  /** 平面六边形坐标的 q 轴值。 */
  q: number;
  /** 平面六边形坐标的 row 轴值。 */
  row: number;
  /** 地块所属 City 的键；水域和荒野没有 City。 */
  city_key: string | null;
  /** 地块所属 City 的类型；非城市地块为空。 */
  city_type: string | null;
  /** 地块所属 Federation；中立地形为空。 */
  federation: string | null;
  /** 地块的地形类别。 */
  terrain: HomeProductWorldTerrainKind;
  /** 地块中绘制的内容类别。 */
  content: HomeProductWorldContentKind;
  /** 地块使用的身份色。 */
  accent: string;
  /** 地块填充透明度。 */
  fill_opacity: number;
  /** 地块随大陆向外生长时所属的阶段。 */
  growth_stage: number;
  /** 交互地块对应的命名地貌键。 */
  feature_key: HomeProductWorldFeatureKey | null;
}

/** 地图上的文字标注。 */
export interface HomeProductWorldAnnotation {
  /** 标注的唯一键。 */
  key: string;
  /** 标注的语义类型。 */
  kind: HomeProductWorldAnnotationKind;
  /** 标注对应的翻译键。 */
  label_key: string;
  /** 标注锚点所在的六边形横轴坐标。 */
  q: number;
  /** 标注锚点所在的六边形斜轴坐标。 */
  row: number;
}

/** 信息卡展示所需的地点检查数据。 */
export interface HomeProductWorldInspection {
  /** 被检查地块的完整地图事实。 */
  cell: HomeProductWorldCell;
  /** 信息卡相对视口左侧的位置。 */
  client_x: number;
  /** 信息卡相对视口顶部的位置。 */
  client_y: number;
  /** 信息卡是否由点击固定。 */
  is_pinned: boolean;
}

/** 地图交互事件，供 Hero 管理预览与固定状态。 */
export interface HomeProductWorldInspectEvent {
  /** 触发事件的地块数据。 */
  cell: HomeProductWorldCell;
  /** 指针相对视口左侧的位置。 */
  client_x: number;
  /** 指针相对视口顶部的位置。 */
  client_y: number;
}

/** 固定 HTML 信息卡的输入参数。 */
export interface HomeProductWorldInspectorProps {
  /** 当前预览或固定地点。 */
  inspection: HomeProductWorldInspection | null;
  /** 关闭固定信息卡的回调。 */
  on_close: () => void;
}

/** 地图文字标注层的输入参数。 */
export interface HomeProductWorldAnnotationLayerProps {
  /** 地图文字标注数据。 */
  annotations: readonly HomeProductWorldAnnotation[];
  /** 标注层透明度。 */
  opacity: MotionValue<number> | number;
}

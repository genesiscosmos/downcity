/**
 * 首页统一使用的 Ghost SVG 图形。
 *
 * Hero 城市居民与 Product World 中央 Agent 共用同一条轮廓，使同一 SVG 坐标系
 * 内的位置和尺度变化始终保持角色身份连续。
 */

import { home_world_agent_path } from "@/lib/home-world-geometry";
import type { HomeGhostGlyphProps } from "@/types/home/HomeGhost";

/** 在调用方已有的 SVG 坐标系中渲染 Ghost。 */
export function HomeGhostGlyph({
  center_x,
  center_y,
  size,
  accent,
  eye_class_name = "fill-background",
}: HomeGhostGlyphProps) {
  return (
    <g aria-hidden="true">
      <path d={home_world_agent_path(center_x, center_y, size)} fill={accent} />
      <circle
        cx={center_x - size * 0.132}
        cy={center_y - size * 0.081}
        r={size * 0.041}
        className={eye_class_name}
      />
      <circle
        cx={center_x + size * 0.132}
        cy={center_y - size * 0.081}
        r={size * 0.041}
        className={eye_class_name}
      />
    </g>
  );
}

export default HomeGhostGlyph;

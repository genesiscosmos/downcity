/**
 * 首页统一舞台中的 2D City 正立面绘图层。
 *
 * 该模块只负责 SVG 内容，不拥有 Section、滚动监听或独立坐标系。建筑采用纯正面
 * 轮廓，通过低饱和色块、窗光、植物与街道设施形成一座有居民的 Agent 城市。
 */

import type { KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { HomeGhostGlyph } from "@/components/shared/HomeGhostGlyph";
import { home_ghosts } from "@/lib/home-ghosts";
import type { HomeHeroCityStageProps } from "@/types/home/HomeGhost";

/** 五位可选 Agent 在统一 1200×720 坐标系中的城市位置。 */
export const home_hero_agent_positions = {
  blue: { x: 238, y: 610 },
  green: { x: 468, y: 502 },
  rust: { x: 642, y: 620 },
  violet: { x: 866, y: 610 },
  red: { x: 1052, y: 610 },
} as const;

const facade_buildings = [
  { key: "west_home", x: -12, width: 76, top_y: 574, accent: "#557b70", kind: "house", rows: 1, columns: 2 },
  { key: "west_greenhouse", x: 78, width: 66, top_y: 592, accent: "#557b70", kind: "greenhouse", rows: 1, columns: 2 },
  { key: "studio", x: 194, width: 86, top_y: 520, accent: "#4f6f9f", kind: "studio", rows: 3, columns: 2 },
  { key: "studio_annex", x: 292, width: 58, top_y: 578, accent: "#716a9f", kind: "workshop", rows: 1, columns: 2 },
  { key: "landmark", x: 432, width: 74, top_y: 462, accent: "#4f6f9f", kind: "tower", rows: 4, columns: 2 },
  { key: "garden_house", x: 520, width: 60, top_y: 576, accent: "#557b70", kind: "garden", rows: 1, columns: 2 },
  { key: "plaza_pavilion", x: 706, width: 62, top_y: 586, accent: "#9a6b5d", kind: "house", rows: 1, columns: 2 },
  { key: "greenhouse", x: 780, width: 66, top_y: 590, accent: "#557b70", kind: "greenhouse", rows: 1, columns: 2 },
  { key: "workshop", x: 858, width: 96, top_y: 548, accent: "#b45d4c", kind: "workshop", rows: 2, columns: 3 },
  { key: "east_studio", x: 1010, width: 76, top_y: 526, accent: "#716a9f", kind: "studio", rows: 3, columns: 2 },
  { key: "east_home", x: 1122, width: 90, top_y: 572, accent: "#557b70", kind: "house", rows: 1, columns: 2 },
] as const;

const ambient_agents = [
  { key: "a01", x: 44, y: 616, size: 15, accent: "#557b70" },
  { key: "a02", x: 118, y: 616, size: 13, accent: "#9a6b5d" },
  { key: "a03", x: 246, y: 556, size: 13, accent: "#4f6f9f" },
  { key: "a04", x: 332, y: 616, size: 14, accent: "#716a9f" },
  { key: "a05", x: 474, y: 516, size: 13, accent: "#557b70" },
  { key: "a06", x: 550, y: 616, size: 13, accent: "#9a6b5d" },
  { key: "a07", x: 744, y: 616, size: 14, accent: "#4f6f9f" },
  { key: "a08", x: 910, y: 584, size: 13, accent: "#b45d4c" },
  { key: "a09", x: 1048, y: 566, size: 13, accent: "#716a9f" },
  { key: "a10", x: 1172, y: 616, size: 14, accent: "#557b70" },
] as const;

/** 生成不同建筑类型的正面屋顶轮廓。 */
function get_building_path(building: (typeof facade_buildings)[number]) {
  const right_x = building.x + building.width;
  if (building.kind === "house") {
    return `M${building.x} 646 V${building.top_y + 34} L${building.x + building.width / 2} ${building.top_y} L${right_x} ${building.top_y + 34} V646 Z`;
  }
  if (building.kind === "greenhouse") {
    return `M${building.x} 646 V${building.top_y + 28} Q${building.x + building.width / 2} ${building.top_y - 12} ${right_x} ${building.top_y + 28} V646 Z`;
  }
  if (building.kind === "studio") {
    return `M${building.x} 646 V${building.top_y + 18} H${building.x + building.width * 0.58} V${building.top_y} H${right_x} V646 Z`;
  }
  return `M${building.x} 646 V${building.top_y} H${right_x} V646 Z`;
}

/** 绘制单栋建筑的色块、窗格、入口与屋顶细节。 */
function render_building(building: (typeof facade_buildings)[number]) {
  const content_top = building.top_y + (building.kind === "house" ? 38 : 24);
  const row_gap = (604 - content_top) / Math.max(1, building.rows - 1);
  const column_gap = building.width / (building.columns + 1);

  return (
    <g key={building.key}>
      <path d={get_building_path(building)} fill={building.accent} fillOpacity="0.045" stroke={building.accent} strokeOpacity="0.38" strokeWidth="1.1" />
      <rect x={building.x + 4} y={Math.max(content_top - 10, building.top_y + 5)} width={building.width - 8} height="6" rx="2" fill={building.accent} fillOpacity="0.07" />
      {Array.from({ length: building.rows }, (_, row_index) => (
        <g key={`${building.key}-row-${row_index}`}>
          {Array.from({ length: building.columns }, (__, column_index) => (
            <rect
              key={`${building.key}-window-${column_index}`}
              x={building.x + column_gap * (column_index + 1) - 6}
              y={content_top + row_gap * row_index - 5}
              width="12"
              height={building.kind === "workshop" ? 11 : 10}
              rx="2"
              fill={building.accent}
              fillOpacity={(row_index + column_index) % 3 === 0 ? 0.2 : 0.07}
              stroke={building.accent}
              strokeOpacity="0.32"
            />
          ))}
        </g>
      ))}
      <path d={`M${building.x + building.width / 2 - 11} 646 V620 Q${building.x + building.width / 2} 608 ${building.x + building.width / 2 + 11} 620 V646`} fill={building.accent} fillOpacity="0.08" stroke={building.accent} strokeOpacity="0.34" />
      {building.kind === "tower" ? (
        <g stroke={building.accent} strokeOpacity="0.5">
          <path d={`M${building.x + building.width / 2} ${building.top_y} V${building.top_y - 42}`} />
          <circle cx={building.x + building.width / 2} cy={building.top_y - 47} r="3.5" fill={building.accent} />
        </g>
      ) : null}
      {building.kind === "garden" ? (
        <g fill="#557b70" fillOpacity="0.2" stroke="#557b70" strokeOpacity="0.42">
          <circle cx={building.x + 14} cy={building.top_y - 5} r="9" />
          <circle cx={building.x + 31} cy={building.top_y - 7} r="12" />
          <circle cx={building.x + 48} cy={building.top_y - 4} r="8" />
        </g>
      ) : null}
    </g>
  );
}

/** 绘制街道中的树木、灌木、路灯和长椅。 */
function render_street_detail(x: number, variant: number) {
  if (variant % 3 === 0) {
    return <g key={x}><path d={`M${x} 622 V649`} stroke="#557b70" strokeOpacity="0.42" /><circle cx={x} cy="610" r="14" fill="#557b70" fillOpacity="0.1" stroke="#557b70" strokeOpacity="0.36" /><circle cx={x - 9} cy="616" r="9" fill="#557b70" fillOpacity="0.07" /></g>;
  }
  if (variant % 3 === 1) {
    return <g key={x} fill="none" stroke="currentColor" strokeOpacity="0.24"><path d={`M${x} 596 V647 M${x} 596 Q${x + 20} 600 ${x + 18} 617`} /><circle cx={x + 18} cy="620" r="4" fill="currentColor" fillOpacity="0.18" /></g>;
  }
  return <g key={x} fill="none" stroke="currentColor" strokeOpacity="0.25"><path d={`M${x - 18} 632 H${x + 18} V640 H${x - 18} Z M${x - 13} 640 V648 M${x + 13} 640 V648`} /></g>;
}

/** 支持键盘选择城市居民。 */
function handle_agent_key_down(event: KeyboardEvent<SVGGElement>, ghost_key: string, on_select_ghost: (ghost_key: string) => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  on_select_ghost(ghost_key);
}

/** 渲染与产品世界共享坐标系的城市正立面。 */
export function HomeHeroCityStage({ selected_ghost_key, on_select_ghost, city_opacity, city_y, city_scale }: HomeHeroCityStageProps) {
  const reduce_motion = useReducedMotion();

  return (
    <motion.g style={{ opacity: city_opacity, y: city_y, scale: city_scale, transformOrigin: "600px 646px", willChange: "transform, opacity" }}>
      <g aria-hidden="true" className="pointer-events-none">
        <ellipse cx="600" cy="668" rx="650" ry="42" fill="#4f6f9f" fillOpacity="0.018" />
        {facade_buildings.map(render_building)}
        <path d="M-40 646 H1240 M-40 660 H1240" className="stroke-line-strong" strokeWidth="1.2" />
        <path d="M-30 681 H1230" className="stroke-line" strokeDasharray="24 20" />
        <path d="M280 574 H322 V584 H280 M954 578 H1010 V588 H954" fill="var(--color-background)" className="stroke-line" />
        <g className="fill-none stroke-line-strong" strokeOpacity="0.55">
          <path d="M596 646 V608 H688 V646" />
          <path d="M612 608 Q642 586 672 608" />
          <path d="M620 629 H664 M628 629 V638 M656 629 V638" />
        </g>
        <g fill="#557b70" fillOpacity="0.08" stroke="#557b70" strokeOpacity="0.28">
          <circle cx="376" cy="631" r="12" /><circle cx="394" cy="634" r="9" />
          <circle cx="972" cy="633" r="11" /><circle cx="990" cy="636" r="8" />
        </g>
        {[34, 166, 372, 548, 684, 752, 974, 1102, 1192].map(render_street_detail)}
        <g fill="#557b70" fillOpacity="0.12" stroke="#557b70" strokeOpacity="0.3">
          {[188, 206, 1016, 1040].map((x) => <circle key={x} cx={x} cy="638" r={x % 2 === 0 ? 10 : 7} />)}
        </g>
      </g>

      <g aria-hidden="true" className="pointer-events-none">
        {ambient_agents.map((agent) => (
          <g key={agent.key} opacity="0.46">
            <HomeGhostGlyph center_x={agent.x} center_y={agent.y} size={agent.size} accent={agent.accent} />
          </g>
        ))}
      </g>

      <g role="group" aria-label="Choose an Agent">
        {home_ghosts.filter((ghost) => ghost.key !== selected_ghost_key).map((ghost) => {
          const position = home_hero_agent_positions[ghost.key as keyof typeof home_hero_agent_positions];
          return (
            <motion.g
              key={ghost.key}
              role="button"
              tabIndex={0}
              aria-label={ghost.aria_label}
              aria-pressed="false"
              className="cursor-pointer outline-none"
              onClick={() => on_select_ghost(ghost.key)}
              onKeyDown={(event: KeyboardEvent<SVGGElement>) => handle_agent_key_down(event, ghost.key, on_select_ghost)}
              style={{ transformOrigin: `${position.x}px ${position.y}px` }}
              initial={{ opacity: 0.48 }}
              whileHover={reduce_motion ? undefined : { scale: 1.15, y: -4, opacity: 1 }}
              whileFocus={reduce_motion ? undefined : { scale: 1.15, y: -4, opacity: 1 }}
              transition={{ duration: reduce_motion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <ellipse cx={position.x} cy={position.y + 13} rx="16" ry="4" fill={ghost.accent} fillOpacity="0.08" />
              <HomeGhostGlyph center_x={position.x} center_y={position.y} size={26} accent={ghost.accent} />
            </motion.g>
          );
        })}
      </g>
    </motion.g>
  );
}

export default HomeHeroCityStage;

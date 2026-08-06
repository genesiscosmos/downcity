/**
 * 首页 Product World 的 SVG 地图绘图层。
 *
 * 能力汇聚、地块生长和边界显示都由 Hero 的单一滚动进度驱动；本组件只处理
 * 地图内容与轻量地点交互，不创建滚动监听，也不拥有固定信息卡状态。
 */

import { motion, type MotionValue } from "framer-motion";
import { HomeCapabilityConvergenceLayer } from "@/components/sections/HomeCapabilityConvergenceLayer";
import { HomeProductWorldAnnotationLayer } from "@/components/sections/HomeProductWorldAnnotationLayer";
import {
  home_product_world_annotations,
  home_product_world_city_edges,
  home_product_world_federation_edges,
  home_product_world_growth_groups,
  home_product_world_origin,
  home_product_world_interactive_cell_keys,
} from "@/lib/home-product-world-layout";
import { home_world_agent_path, home_world_hex_center, home_world_hex_path } from "@/lib/home-world-geometry";
import type { HomeProductWorldCell, HomeProductWorldInspectEvent } from "@/types/home/HomeProductWorld";
import type { HomeProductWorldSectionProps } from "@/types/home/HomeGhost";

function render_cell_content(cell: HomeProductWorldCell, center_x: number, center_y: number, radius: number) {
  const accent = cell.accent;
  if (cell.content === "agent") {
    return <g><path d={home_world_agent_path(center_x, center_y, radius * 0.78)} fill={accent} /><circle cx={center_x - radius * 0.1} cy={center_y - radius * 0.06} r={radius * 0.032} className="fill-background" /><circle cx={center_x + radius * 0.1} cy={center_y - radius * 0.06} r={radius * 0.032} className="fill-background" /></g>;
  }
  if (cell.content === "water") {
    return <path d={`M${center_x - radius * 0.48} ${center_y} Q${center_x - radius * 0.2} ${center_y - radius * 0.2} ${center_x} ${center_y} T${center_x + radius * 0.48} ${center_y}`} fill="none" stroke={accent} strokeOpacity="0.56" strokeWidth="1.5" />;
  }
  if (cell.content === "forest") {
    return <g className="fill-none" stroke={accent} strokeOpacity="0.56"><path d={`M${center_x - radius * 0.3} ${center_y + radius * 0.24} L${center_x - radius * 0.08} ${center_y - radius * 0.3} L${center_x + radius * 0.12} ${center_y + radius * 0.24} Z`} /><path d={`M${center_x + radius * 0.04} ${center_y + radius * 0.24} L${center_x + radius * 0.27} ${center_y - radius * 0.36} L${center_x + radius * 0.48} ${center_y + radius * 0.24} Z`} /></g>;
  }
  if (cell.content === "building") {
    return <g className="fill-none" stroke={accent} strokeOpacity="0.54"><path d={`M${center_x - radius * 0.34} ${center_y + radius * 0.3} V${center_y - radius * 0.26} H${center_x + radius * 0.02} V${center_y + radius * 0.3}`} /><path d={`M${center_x + radius * 0.02} ${center_y + radius * 0.3} V${center_y - radius * 0.06} H${center_x + radius * 0.34} V${center_y + radius * 0.3}`} /></g>;
  }
  if (cell.content === "workshop") {
    return <g className="fill-none" stroke={accent} strokeOpacity="0.56"><path d={`M${center_x - radius * 0.36} ${center_y - radius * 0.22} H${center_x + radius * 0.2} V${center_y + radius * 0.28} H${center_x - radius * 0.36} Z`} /><path d={`M${center_x - radius * 0.18} ${center_y - radius * 0.38} H${center_x + radius * 0.38} V${center_y + radius * 0.12}`} /></g>;
  }
  if (cell.content === "plaza") {
    return <g className="fill-none" stroke={accent} strokeOpacity="0.54"><path d={`M${center_x} ${center_y - radius * 0.3} L${center_x + radius * 0.3} ${center_y} L${center_x} ${center_y + radius * 0.3} L${center_x - radius * 0.3} ${center_y} Z`} /><path d={`M${center_x} ${center_y - radius * 0.3} V${center_y - radius * 0.46} M${center_x + radius * 0.3} ${center_y} H${center_x + radius * 0.46}`} /></g>;
  }
  return null;
}

function render_growth_group(
  cells: readonly HomeProductWorldCell[],
  opacity: MotionValue<number> | number,
  scale: MotionValue<number> | number,
  active_cell_key: string | null,
  is_interactive: boolean,
  on_cell_preview: (event: HomeProductWorldInspectEvent) => void,
  on_cell_preview_end: HomeProductWorldSectionProps["on_cell_preview_end"],
  on_cell_select: (event: HomeProductWorldInspectEvent) => void,
) {
  return (
    <motion.g style={{ opacity, scale, transformOrigin: "600px 360px", willChange: "transform, opacity" }}>
      {cells.map((cell) => {
        const center = home_world_hex_center(home_product_world_origin.x, home_product_world_origin.y, home_product_world_origin.radius, cell.q, cell.row);
        const is_active = active_cell_key === cell.key;
        const is_explorable = is_interactive && home_product_world_interactive_cell_keys.has(cell.key);
        const cell_class_name = is_explorable
          ? "pointer-events-auto cursor-pointer outline-none transition-[filter] duration-150 hover:brightness-125 focus-visible:brightness-125"
          : "pointer-events-none";
        const cell_content = (
          <>
            <path d={home_world_hex_path(center.x, center.y, home_product_world_origin.radius)} fill={cell.accent} fillOpacity={is_active ? cell.fill_opacity + 0.08 : cell.fill_opacity} className={is_active ? "stroke-foreground" : "stroke-line-strong"} strokeWidth={is_active ? "1.5" : "0.85"} />
            {render_cell_content(cell, center.x, center.y, home_product_world_origin.radius)}
          </>
        );
        if (!is_explorable) return <g key={cell.key}>{cell_content}</g>;
        return (
          <g
            key={cell.key}
            role="button"
            tabIndex={0}
            aria-label={cell.feature_key ?? cell.city_key ?? cell.key}
            data-world-cell-key={cell.key}
            className={cell_class_name}
            onPointerEnter={(event) => on_cell_preview({ cell, client_x: event.clientX, client_y: event.clientY })}
            onMouseLeave={on_cell_preview_end}
            onFocus={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              on_cell_preview({ cell, client_x: rect.right, client_y: rect.top + rect.height / 2 });
            }}
            onBlur={on_cell_preview_end}
            onClick={(event) => on_cell_select({ cell, client_x: event.clientX, client_y: event.clientY })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                on_cell_select({ cell, client_x: rect.right, client_y: rect.top + rect.height / 2 });
              }
              if (event.key === "Escape") on_cell_preview_end();
            }}
          >
            {cell_content}
          </g>
        );
      })}
    </motion.g>
  );
}

/** 绘制能力、地图、边界与文字标注。 */
export function HomeProductWorldSection({
  agent_accent,
  capability_progress,
  growth_opacities,
  growth_scales,
  active_cell_key,
  is_interactive,
  on_cell_preview,
  on_cell_preview_end,
  on_cell_select,
  city_boundary_opacity,
  federation_boundary_opacity,
  federation_boundary_path,
}: HomeProductWorldSectionProps) {
  return (
    <>
      <HomeCapabilityConvergenceLayer agent_accent={agent_accent} capability_progress={capability_progress} />
      <g data-world-map-layer="">
        {home_product_world_growth_groups.map((cells, index) => render_growth_group(cells, growth_opacities[index] ?? 0, growth_scales[index] ?? 1, active_cell_key, is_interactive, on_cell_preview, on_cell_preview_end, on_cell_select))}
        <motion.g style={{ opacity: city_boundary_opacity }}>
          {home_product_world_city_edges.map((path, index) => <path key={`city-edge-${index}`} d={path} className="fill-none stroke-foreground" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round" />)}
        </motion.g>
        <motion.g style={{ opacity: federation_boundary_opacity }}>
          {home_product_world_federation_edges.map((path, index) => <motion.path key={`federation-edge-${index}`} d={path} className="fill-none stroke-foreground" strokeWidth="4.4" strokeLinecap="round" style={{ pathLength: federation_boundary_path }} />)}
        </motion.g>
        <HomeProductWorldAnnotationLayer annotations={home_product_world_annotations} opacity={federation_boundary_opacity} />
      </g>
    </>
  );
}

export default HomeProductWorldSection;

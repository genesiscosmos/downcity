/**
 * 首页统一 Hero World 舞台中的 Capabilities 与蜂巢大陆绘图层。
 *
 * 本组件不创建 Section，也不监听滚动。所有动画值都来自外层唯一的滚动进度，
 * 从而让能力集成、地块生长、City 与 Federation 保持连续且可逆。
 */

import { motion, type MotionValue } from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import {
  home_product_world_city_edges,
  home_product_world_federation_edges,
  home_product_world_growth_groups,
  home_product_world_origin,
} from "@/lib/home-product-world-layout";
import { home_world_agent_path, home_world_hex_center, home_world_hex_path } from "@/lib/home-world-geometry";
import type { HomeProductWorldSectionProps } from "@/types/home/HomeGhost";

const capability_nodes = [
  { key: "tool", x: 405, y: 218 },
  { key: "skill", x: 795, y: 218 },
  { key: "memory", x: 318, y: 360 },
  { key: "task", x: 882, y: 360 },
  { key: "service", x: 410, y: 510 },
  { key: "model", x: 790, y: 510 },
] as const;

/** 渲染地块内部的 Agent、建筑、工作室、森林与广场。 */
function render_cell_content(content: string, center_x: number, center_y: number, radius: number, accent: string) {
  if (content === "agent") {
    return <g><path d={home_world_agent_path(center_x, center_y, radius * 0.78)} fill={accent} /><circle cx={center_x - radius * 0.1} cy={center_y - radius * 0.06} r={radius * 0.032} className="fill-background" /><circle cx={center_x + radius * 0.1} cy={center_y - radius * 0.06} r={radius * 0.032} className="fill-background" /></g>;
  }
  if (content === "forest") {
    return <g className="fill-none stroke-foreground" strokeOpacity="0.44"><path d={`M${center_x - radius * 0.3} ${center_y + radius * 0.24} L${center_x - radius * 0.08} ${center_y - radius * 0.3} L${center_x + radius * 0.12} ${center_y + radius * 0.24} Z`} /><path d={`M${center_x + radius * 0.04} ${center_y + radius * 0.24} L${center_x + radius * 0.27} ${center_y - radius * 0.36} L${center_x + radius * 0.48} ${center_y + radius * 0.24} Z`} /></g>;
  }
  if (content === "building") {
    return <g className="fill-none stroke-foreground" strokeOpacity="0.44"><path d={`M${center_x - radius * 0.34} ${center_y + radius * 0.3} V${center_y - radius * 0.26} H${center_x + radius * 0.02} V${center_y + radius * 0.3}`} /><path d={`M${center_x + radius * 0.02} ${center_y + radius * 0.3} V${center_y - radius * 0.06} H${center_x + radius * 0.34} V${center_y + radius * 0.3}`} /></g>;
  }
  if (content === "workshop") {
    return <g className="fill-none stroke-foreground" strokeOpacity="0.48"><path d={`M${center_x - radius * 0.36} ${center_y - radius * 0.22} H${center_x + radius * 0.2} V${center_y + radius * 0.28} H${center_x - radius * 0.36} Z`} /><path d={`M${center_x - radius * 0.18} ${center_y - radius * 0.38} H${center_x + radius * 0.38} V${center_y + radius * 0.12}`} /></g>;
  }
  if (content === "plaza") {
    return <g className="fill-none stroke-foreground" strokeOpacity="0.44"><path d={`M${center_x} ${center_y - radius * 0.3} L${center_x + radius * 0.3} ${center_y} L${center_x} ${center_y + radius * 0.3} L${center_x - radius * 0.3} ${center_y} Z`} /><path d={`M${center_x} ${center_y - radius * 0.3} V${center_y - radius * 0.46} M${center_x + radius * 0.3} ${center_y} H${center_x + radius * 0.46}`} /></g>;
  }
  return null;
}

/** 渲染同一扩散阶段中的连续大陆地块。 */
function render_growth_group(
  cells: (typeof home_product_world_growth_groups)[number],
  opacity: number | MotionValue<number>,
  scale: number | MotionValue<number>,
) {
  return (
    <motion.g style={{ opacity, scale, transformOrigin: "600px 360px", willChange: "transform, opacity" }}>
      {cells.map((cell) => {
        const center = home_world_hex_center(home_product_world_origin.x, home_product_world_origin.y, home_product_world_origin.radius, cell.q, cell.row);
        return (
          <g key={cell.key}>
            <path d={home_world_hex_path(center.x, center.y, home_product_world_origin.radius)} fill={cell.accent} fillOpacity={cell.fill_opacity} className="stroke-line-strong" strokeWidth="0.85" />
            {cell.q === 0 && cell.row === 0 ? null : render_cell_content(cell.content, center.x, center.y, home_product_world_origin.radius, cell.accent)}
          </g>
        );
      })}
    </motion.g>
  );
}

/** 绘制能力集成与完整蜂巢大陆。 */
export function HomeProductWorldSection({
  agent_accent,
  capability_opacity,
  capability_scale,
  capability_rotate,
  capability_path,
  integration_ring_opacity,
  integration_ring_scale,
  growth_opacities,
  growth_scales,
  city_boundary_opacity,
  federation_boundary_opacity,
  federation_boundary_path,
}: HomeProductWorldSectionProps) {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");

  return (
    <>
      <motion.g style={{ opacity: capability_opacity, scale: capability_scale, rotate: capability_rotate, transformOrigin: "600px 360px", willChange: "transform, opacity" }}>
        <ellipse cx="600" cy="360" rx="292" ry="214" fill="none" stroke={agent_accent} strokeDasharray="3 9" opacity="0.28" />
        {capability_nodes.map((node) => (
          <g key={node.key}>
            <motion.path d={`M${node.x} ${node.y} Q600 360 600 360`} fill="none" stroke={agent_accent} strokeOpacity="0.4" style={{ pathLength: capability_path }} />
            <circle cx={node.x} cy={node.y} r="34" className="fill-background" stroke={agent_accent} strokeWidth="1.2" />
            <circle cx={node.x} cy={node.y} r="25" fill={agent_accent} fillOpacity="0.06" />
            <text x={node.x} y={node.y + 4} textAnchor="middle" className="fill-text-soft text-[11px] font-medium">{t(`productWorld.labels.${node.key}`)}</text>
          </g>
        ))}
      </motion.g>

      <motion.circle cx="600" cy="360" r="78" fill="none" stroke={agent_accent} strokeWidth="1.5" style={{ opacity: integration_ring_opacity, scale: integration_ring_scale, transformOrigin: "600px 360px" }} />

      <g>
        {home_product_world_growth_groups.map((cells, index) => (
          <g key={`growth-${index}`}>
            {render_growth_group(cells, growth_opacities[index] ?? 0, growth_scales[index] ?? 1)}
          </g>
        ))}
        <motion.g style={{ opacity: city_boundary_opacity }}>
          {home_product_world_city_edges.map((path, index) => <path key={`city-edge-${index}`} d={path} className="fill-none stroke-foreground" strokeOpacity="0.38" strokeWidth="1.8" strokeLinecap="round" />)}
        </motion.g>
        <motion.g style={{ opacity: federation_boundary_opacity }}>
          {home_product_world_federation_edges.map((path, index) => <motion.path key={`federation-edge-${index}`} d={path} className="fill-none stroke-foreground" strokeWidth="4.8" strokeLinecap="round" style={{ pathLength: federation_boundary_path }} />)}
        </motion.g>
      </g>
    </>
  );
}

export default HomeProductWorldSection;

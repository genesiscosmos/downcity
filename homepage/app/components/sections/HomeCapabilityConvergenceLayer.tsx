/**
 * 首页 Product World 中的能力引力汇聚绘图层。
 *
 * 六个能力节点各自拥有独立的吸收时序与贝塞尔轨迹，但都只消费外层提供的同一
 * 汇聚进度。节点先积聚张力，再错峰加速进入中央 Ghost，最后由一次冲击波把能量
 * 交给地图生长阶段；组件自身不监听滚动，也不拥有叙事生命周期。
 */

import { motion, useTransform } from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import type {
  HomeCapabilityConvergenceLayerProps,
  HomeCapabilityNodeDefinition,
  HomeCapabilityNodeProps,
} from "@/types/home/HomeGhost";

const gravity_center = { x: 600, y: 360 } as const;

const capability_nodes: readonly HomeCapabilityNodeDefinition[] = [
  { key: "tool", x: 405, y: 218, curve_x: 500, curve_y: 246, absorb_start: 0.34, absorb_end: 0.62, vibration_phase: 0.2, label_offset_y: -27 },
  { key: "task", x: 882, y: 360, curve_x: 748, curve_y: 314, absorb_start: 0.38, absorb_end: 0.66, vibration_phase: 1.4, label_offset_y: -27 },
  { key: "service", x: 410, y: 510, curve_x: 486, curve_y: 424, absorb_start: 0.42, absorb_end: 0.70, vibration_phase: 2.1, label_offset_y: 34 },
  { key: "skill", x: 795, y: 218, curve_x: 690, curve_y: 258, absorb_start: 0.46, absorb_end: 0.74, vibration_phase: 2.8, label_offset_y: -27 },
  { key: "memory", x: 318, y: 360, curve_x: 458, curve_y: 408, absorb_start: 0.50, absorb_end: 0.78, vibration_phase: 3.7, label_offset_y: -27 },
  { key: "model", x: 790, y: 510, curve_x: 704, curve_y: 430, absorb_start: 0.54, absorb_end: 0.82, vibration_phase: 4.5, label_offset_y: 34 },
] as const;

function clamp_unit(value: number) {
  return Math.min(1, Math.max(0, value));
}

function get_quadratic_position(start: number, control: number, end: number, progress: number) {
  const remaining = 1 - progress;
  return remaining * remaining * start + 2 * remaining * progress * control + progress * progress * end;
}

function get_node_axis_offset(progress: number, node: HomeCapabilityNodeDefinition, axis: "x" | "y") {
  const start_value = node[axis];
  const control_value = axis === "x" ? node.curve_x : node.curve_y;
  const end_value = gravity_center[axis];
  if (progress < node.absorb_start) {
    const tension_progress = clamp_unit((progress - 0.1) / (node.absorb_start - 0.1));
    const tension_envelope = Math.sin(tension_progress * Math.PI);
    const inward_offset = (end_value - start_value) * 0.018 * tension_envelope;
    const vibration_direction = axis === "x" ? 1 : -0.72;
    const vibration_offset = Math.sin(tension_progress * Math.PI * 6 + node.vibration_phase) * tension_envelope * 1.8 * vibration_direction;
    return inward_offset + vibration_offset;
  }
  const raw_absorb_progress = clamp_unit((progress - node.absorb_start) / (node.absorb_end - node.absorb_start));
  return get_quadratic_position(start_value, control_value, end_value, raw_absorb_progress ** 2.45) - start_value;
}

function HomeCapabilityNode({ node, label, agent_accent, capability_progress }: HomeCapabilityNodeProps) {
  const node_x = useTransform(capability_progress, (progress) => get_node_axis_offset(progress, node, "x"));
  const node_y = useTransform(capability_progress, (progress) => get_node_axis_offset(progress, node, "y"));
  const node_opacity = useTransform(capability_progress, [0.02, 0.13, node.absorb_end - 0.045, node.absorb_end], [0, 1, 1, 0]);
  const node_scale = useTransform(capability_progress, (progress) => {
    if (progress < node.absorb_start) {
      const tension_progress = clamp_unit((progress - 0.1) / (node.absorb_start - 0.1));
      return 1 + Math.sin(tension_progress * Math.PI * 5 + node.vibration_phase) * tension_progress * 0.018;
    }
    const absorb_progress = clamp_unit((progress - node.absorb_start) / (node.absorb_end - node.absorb_start));
    if (absorb_progress < 0.7) return 1 + absorb_progress * 0.09;
    const collapse_progress = (absorb_progress - 0.7) / 0.3;
    return 1.063 - collapse_progress * collapse_progress * 0.983;
  });
  const label_opacity = useTransform(capability_progress, [0.04, 0.14, node.absorb_start, node.absorb_start + 0.09], [0, 0.72, 0.72, 0]);
  const field_opacity = useTransform(capability_progress, [0.08, 0.2, node.absorb_start, node.absorb_end], [0, 0.16, 0.3, 0]);
  const connection_length = useTransform(capability_progress, (progress) => 1 - clamp_unit((progress - node.absorb_start) / (node.absorb_end - node.absorb_start)) ** 2.45);
  const connection_opacity = useTransform(capability_progress, [node.absorb_start, node.absorb_start + 0.06, node.absorb_end - 0.025, node.absorb_end], [0, 0.72, 0.5, 0]);
  const impact_opacity = useTransform(capability_progress, [node.absorb_end - 0.018, node.absorb_end, node.absorb_end + 0.035], [0, 0.9, 0]);
  const impact_scale = useTransform(capability_progress, [node.absorb_end - 0.018, node.absorb_end + 0.035], [0.35, 1.7]);
  const path = `M${node.x} ${node.y} Q${node.curve_x} ${node.curve_y} ${gravity_center.x} ${gravity_center.y}`;
  const reversed_path = `M${gravity_center.x} ${gravity_center.y} Q${node.curve_x} ${node.curve_y} ${node.x} ${node.y}`;
  return (
    <g>
      <motion.path d={path} fill="none" stroke={agent_accent} strokeWidth="0.85" strokeDasharray="2 7" strokeLinecap="round" style={{ opacity: field_opacity }} />
      <motion.path d={reversed_path} fill="none" stroke={agent_accent} strokeWidth="2" strokeLinecap="round" style={{ opacity: connection_opacity, pathLength: connection_length }} />
      <motion.g style={{ x: node_x, y: node_y, scale: node_scale, opacity: node_opacity, transformOrigin: `${node.x}px ${node.y}px`, willChange: "transform, opacity" }}>
        <circle cx={node.x} cy={node.y} r="23" fill="var(--color-background)" fillOpacity="0.82" stroke={agent_accent} strokeOpacity="0.34" strokeWidth="1" />
        <circle cx={node.x} cy={node.y} r="10.5" fill="none" stroke={agent_accent} strokeOpacity="0.18" strokeWidth="4.2" />
        <circle cx={node.x} cy={node.y} r="4.2" fill={agent_accent} fillOpacity="0.88" />
        <motion.text x={node.x} y={node.y + node.label_offset_y} textAnchor="middle" className="fill-text-soft text-[11px] font-medium" style={{ opacity: label_opacity, letterSpacing: "0.08em" }}>{label}</motion.text>
      </motion.g>
      <motion.circle cx={gravity_center.x} cy={gravity_center.y} r="19" fill="none" stroke={agent_accent} strokeWidth="2" style={{ opacity: impact_opacity, scale: impact_scale, transformOrigin: `${gravity_center.x}px ${gravity_center.y}px` }} />
    </g>
  );
}

export function HomeCapabilityConvergenceLayer({ agent_accent, capability_progress }: HomeCapabilityConvergenceLayerProps) {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const field_opacity = useTransform(capability_progress, [0, 0.12, 0.58, 0.82], [0, 0.28, 0.34, 0]);
  const field_scale = useTransform(capability_progress, [0, 0.18, 0.64, 0.82], [1.22, 1, 0.68, 0.46]);
  const center_energy_opacity = useTransform(capability_progress, [0.58, 0.76, 0.84, 0.92], [0, 0.18, 0.72, 0]);
  const center_energy_scale = useTransform(capability_progress, [0.58, 0.84, 0.92], [0.6, 1.18, 0.42]);
  const shockwave_opacity = useTransform(capability_progress, [0.8, 0.85, 0.94, 1], [0, 0.9, 0.3, 0]);
  const shockwave_scale = useTransform(capability_progress, [0.8, 0.86, 1], [0.3, 0.68, 1.85]);
  return (
    <g aria-hidden="true">
      <motion.g style={{ opacity: field_opacity, scale: field_scale, transformOrigin: `${gravity_center.x}px ${gravity_center.y}px`, willChange: "transform, opacity" }}>
        <ellipse cx={gravity_center.x} cy={gravity_center.y} rx="270" ry="190" fill="none" stroke={agent_accent} strokeWidth="0.7" strokeDasharray="2 12" />
        <ellipse cx={gravity_center.x} cy={gravity_center.y} rx="182" ry="126" fill="none" stroke={agent_accent} strokeWidth="0.8" strokeDasharray="14 22" strokeOpacity="0.62" />
        <circle cx={gravity_center.x} cy={gravity_center.y} r="88" fill="none" stroke={agent_accent} strokeWidth="0.9" strokeDasharray="3 10" strokeOpacity="0.7" />
      </motion.g>
      {capability_nodes.map((node) => <HomeCapabilityNode key={node.key} node={node} label={t(`productWorld.labels.${node.key}`)} agent_accent={agent_accent} capability_progress={capability_progress} />)}
      <motion.circle cx={gravity_center.x} cy={gravity_center.y} r="34" fill={agent_accent} fillOpacity="0.16" style={{ opacity: center_energy_opacity, scale: center_energy_scale, transformOrigin: `${gravity_center.x}px ${gravity_center.y}px` }} />
      <motion.circle cx={gravity_center.x} cy={gravity_center.y} r="76" fill="none" stroke={agent_accent} strokeWidth="3.2" style={{ opacity: shockwave_opacity, scale: shockwave_scale, transformOrigin: `${gravity_center.x}px ${gravity_center.y}px`, willChange: "transform, opacity" }} />
    </g>
  );
}

export default HomeCapabilityConvergenceLayer;

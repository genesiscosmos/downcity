/**
 * 首页 SDK 世界的滚动叙事地图。
 *
 * 地图以同一套轴向六边形网格表达 Agent、Workspace、Plugin、City 与 Federation。
 * Embassy 只传递 Service 请求与响应，Ghost Agent 始终留在所属 City 中。
 */

import {
  IconBook2,
  IconBrain,
  IconChecklist,
  IconHeadphones,
  IconPhoto,
  IconUserCircle,
  IconWorld,
} from "@tabler/icons-react";
import { motion, useReducedMotion } from "framer-motion";
import {
  get_home_sdk_world_boundary_paths,
  get_home_sdk_world_cell,
  get_home_sdk_world_center,
  home_sdk_world_annotations,
  home_sdk_world_cells,
  home_sdk_world_grid,
} from "@/lib/home-sdk-world-layout";
import { home_world_agent_path, home_world_hex_path } from "@/lib/home-world-geometry";
import type {
  HomeSdkFileKey,
  HomeSdkWorldBoundaryKey,
  HomeSdkWorldCell,
  HomeSdkWorldMapProps,
  HomeSdkWorldPluginKind,
} from "@/types/home/HomeSdkWorld";

/** 地块继承所属区域的身份色，职责差异只通过透明度表达。 */
function get_cell_fill(cell: HomeSdkWorldCell) {
  if (cell.tone === "plugin") return "var(--sdk-map-plugin)";
  if (cell.boundary_key === "origin_city") return "var(--sdk-map-origin)";
  if (cell.boundary_key === "neighbor_city") return "var(--sdk-map-neighbor)";
  if (cell.boundary_key === "third_city") return "var(--sdk-map-third)";
  return "var(--sdk-map-federation)";
}

/** 延续完整地图的轻填充语言，避免六边形成为厚重色块。 */
function get_cell_fill_opacity(cell: HomeSdkWorldCell) {
  if (cell.tone === "workspace") return 0.22;
  if (cell.tone === "plugin") return 0.14;
  if (cell.content === "agent") return 0.16;
  if (cell.tone === "service") return 0.16;
  if (cell.tone === "federation") return 0.13;
  if (cell.tone === "embassy") return 0.08;
  return 0.12;
}

/** 绘制保留在 City 内的 Ghost Agent。 */
function AgentGhost({ x, y, size, accent = "var(--sdk-map-origin)" }: {
  /** Ghost 水平中心。 */ x: number;
  /** Ghost 垂直中心。 */ y: number;
  /** Ghost 轮廓基准尺寸。 */ size: number;
  /** Ghost 身份色。 */ accent?: string;
}) {
  return (
    <g>
      <path
        d={home_world_agent_path(x, y, size)}
        fill={accent}
        stroke={accent}
        strokeOpacity="0.65"
        strokeWidth="0.8"
      />
      <circle cx={x - size * 0.18} cy={y - size * 0.08} r={size * 0.06} fill="var(--sdk-world-background)" />
      <circle cx={x + size * 0.18} cy={y - size * 0.08} r={size * 0.06} fill="var(--sdk-world-background)" />
    </g>
  );
}

const plugin_icon = {
  skill: IconBook2,
  task: IconChecklist,
  web: IconWorld,
  memory: IconBrain,
  image: IconPhoto,
  sound: IconHeadphones,
} satisfies Record<HomeSdkWorldPluginKind, typeof IconBook2>;

/** 使用真实内置 Plugin 的图标区分周围能力地块。 */
function PluginMark({ kind, x, y }: {
  /** Plugin 的内置能力类别。 */ kind: HomeSdkWorldPluginKind;
  /** 图标水平中心。 */ x: number;
  /** 图标垂直中心。 */ y: number;
}) {
  const PluginIcon = plugin_icon[kind];
  return (
    <PluginIcon
      x={x - 8}
      y={y - 8}
      width={16}
      height={16}
      color="var(--sdk-map-plugin)"
      strokeWidth={1.45}
      aria-hidden="true"
    />
  );
}

/** 返回 Embassy 在请求和响应步骤中的收缩与展开状态。 */
function get_portal_motion(cell_key: string, active_step: number) {
  const is_city_origin = cell_key === "origin_embassy";
  const is_federation_origin = cell_key === "federation_embassy_origin";

  if (active_step === 12 && is_city_origin) return { scale: [1, 0.42, 0.78], opacity: [1, 0.35, 0.8] };
  if (active_step === 12 && is_federation_origin) return { scale: [0.72, 1.22, 1], opacity: [0.55, 1, 0.92] };
  if (active_step === 13 && is_federation_origin) return { scale: [1, 0.42, 0.78], opacity: [1, 0.35, 0.8] };
  if (active_step === 13 && is_city_origin) return { scale: [0.72, 1.22, 1], opacity: [0.55, 1, 0.92] };
  return { scale: 1, opacity: 0.9 };
}

/** 绘制 City Embassy 或 Federation 入口的虫洞状态。 */
function PortalMark({ cell_key, x, y, accent, active_step }: {
  /** 入口所在地块的稳定键。 */ cell_key: string;
  /** 入口水平中心。 */ x: number;
  /** 入口垂直中心。 */ y: number;
  /** 入口所属 City 的身份色。 */ accent: string;
  /** 当前滚动叙事步骤。 */ active_step: number;
}) {
  const reduce_motion = useReducedMotion();
  const portal_motion = get_portal_motion(cell_key, active_step);
  const is_transferring = active_step >= 12 && (
    cell_key === "origin_embassy" || cell_key === "federation_embassy_origin"
  );

  return (
    <motion.g
      initial={false}
      animate={reduce_motion ? { scale: 1, opacity: 0.9 } : portal_motion}
      transition={{ duration: reduce_motion ? 0 : 1.1, ease: [0.65, 0, 0.35, 1] }}
      style={{ transformOrigin: `${x}px ${y}px` }}
    >
      <ellipse cx={x} cy={y} rx="11" ry="6.2" fill="var(--sdk-world-background)" stroke={accent} strokeOpacity="0.95" strokeWidth="1.6" />
      <ellipse cx={x} cy={y} rx="7" ry="3.6" fill={accent} fillOpacity="0.13" stroke={accent} strokeOpacity="0.72" strokeWidth="0.9" />
      <ellipse cx={x} cy={y} rx="3.6" ry="1.7" fill={accent} fillOpacity="0.72" />
      {is_transferring ? (
        <motion.circle
          cx={x}
          cy={y}
          r="1.7"
          fill="#fff6ed"
          animate={reduce_motion ? { opacity: 1 } : { opacity: [0.1, 1, 0.1], scale: [0.7, 1.35, 0.7] }}
          transition={{ duration: 1.1, ease: "easeInOut" }}
          style={{ transformOrigin: `${x}px ${y}px` }}
        />
      ) : null}
    </motion.g>
  );
}

/** 渲染轴向网格中的标准地块。 */
function WorldCell({ cell, active_step, emphasis, label }: {
  /** 地块的轴向布局事实。 */ cell: HomeSdkWorldCell;
  /** 当前滚动叙事步骤。 */ active_step: number;
  /** 当前文件对地块的强调程度。 */ emphasis: number;
  /** 地块内显示的本地化名称。 */ label: string | null;
}) {
  const reduce_motion = useReducedMotion();
  const center = get_home_sdk_world_center(cell.q, cell.row);
  const visible = active_step >= cell.visible_step;
  const reveal_order = home_sdk_world_cells
    .filter((candidate) => candidate.visible_step === cell.visible_step)
    .findIndex((candidate) => candidate.key === cell.key);
  const is_active_service = cell.tone === "service" && active_step >= cell.visible_step;

  return (
    <motion.g
      initial={false}
      animate={{ opacity: visible ? emphasis : 0, scale: visible ? 1 : 0.82 }}
      transition={{
        duration: reduce_motion ? 0 : 0.48,
        delay: reduce_motion || !visible ? 0 : Math.max(0, reveal_order) * 0.07,
        ease: [0.22, 1, 0.36, 1],
      }}
      style={{ transformOrigin: `${center.x}px ${center.y}px` }}
      aria-hidden={!visible}
    >
      <motion.path
        d={home_world_hex_path(center.x, center.y, home_sdk_world_grid.radius)}
        fill={get_cell_fill(cell)}
        stroke={cell.portal_accent ?? (is_active_service ? "var(--sdk-map-federation)" : "var(--sdk-map-stroke)")}
        strokeOpacity={cell.portal_accent || is_active_service ? 0.82 : 1}
        strokeWidth={cell.portal_accent || is_active_service ? 1.2 : 0.85}
        animate={is_active_service && !reduce_motion
          ? { fillOpacity: [get_cell_fill_opacity(cell), 0.18, get_cell_fill_opacity(cell)] }
          : { fillOpacity: get_cell_fill_opacity(cell) }}
        transition={is_active_service ? { duration: 1.1, ease: "easeInOut" } : undefined}
      />
      {cell.content === "agent" && cell.agent_accent
        ? <AgentGhost x={center.x} y={center.y - 2} size={17} accent={cell.agent_accent} />
        : null}
      {cell.content === "user" && cell.agent_accent
        ? <IconUserCircle x={center.x - 9} y={center.y - 11} width={18} height={18} color={cell.agent_accent} strokeWidth={1.4} aria-hidden="true" />
        : null}
      {cell.plugin_kind ? <PluginMark kind={cell.plugin_kind} x={center.x} y={center.y} /> : null}
      {cell.portal_accent ? (
        <PortalMark cell_key={cell.key} x={center.x} y={center.y - 3} accent={cell.portal_accent} active_step={active_step} />
      ) : null}
      {label && !cell.portal_accent && !cell.plugin_kind ? (
        <text x={center.x} y={center.y + (cell.content === "user" ? 20 : 2.5)} textAnchor="middle" className="select-none fill-[var(--sdk-world-foreground)] text-[6.5px] font-medium">
          {label}
        </text>
      ) : null}
      {cell.portal_accent && cell.group === "embassy" ? (
        <text x={center.x} y={center.y + 15} textAnchor="middle" className="select-none fill-[var(--sdk-world-muted)] text-[5.5px] font-medium">
          {label}
        </text>
      ) : null}
    </motion.g>
  );
}

/** 根据当前代码文件返回地图领域的视觉权重。 */
function get_group_emphasis(active_file: HomeSdkFileKey, group: HomeSdkWorldCell["group"]) {
  if (active_file === group) return 1;
  if (active_file === "agent" && group === "city") return 0.76;
  if (active_file === "city" && group === "agent") return 0.82;
  if (active_file === "agent" && group === "embassy") return 0.84;
  if (active_file === "federation" && group === "embassy") return 0.82;
  return 0.5;
}

/** 返回区域边界应跟随的代码领域。 */
function get_boundary_group(boundary_key: HomeSdkWorldBoundaryKey): HomeSdkWorldCell["group"] {
  return boundary_key === "federation" ? "federation" : "city";
}

/** 绘制从 Agent 生长为多个 City 与 Federation Service 网络的完整地图。 */
export function HomeSdkWorldMap({ active_step, active_file, aria_label, labels }: HomeSdkWorldMapProps) {
  const reduce_motion = useReducedMotion();
  const transition = { duration: reduce_motion ? 0 : 0.62, ease: [0.22, 1, 0.36, 1] as const };
  const workspace_cell = get_home_sdk_world_cell("workspace");
  const workspace_center = get_home_sdk_world_center(workspace_cell.q, workspace_cell.row);
  const user_cell = get_home_sdk_world_cell("origin_user");
  const user_center = get_home_sdk_world_center(user_cell.q, user_cell.row);
  const camera_view_box = active_step <= 4
    ? "35 100 250 235"
    : active_step === 5
      ? "35 90 280 255"
      : active_step === 6
        ? "20 55 340 330"
        : active_step === 7
          ? "10 20 455 390"
          : active_step <= 9
            ? "5 5 500 420"
            : "0 0 650 430";
  const agent_emphasis = get_group_emphasis(active_file, "agent");

  const get_cell_label = (cell: HomeSdkWorldCell) => {
    if (!cell.label_key) return null;
    if (cell.label_key !== "service") return labels[cell.label_key];
    return `${labels.service} ${cell.key.split("_").at(-1)}`;
  };

  return (
    <div className="relative h-full min-h-0 w-full min-w-0" aria-label={aria_label}>
      <motion.svg
        viewBox="0 0 650 430"
        animate={{ viewBox: camera_view_box }}
        transition={transition}
        role="img"
        className="h-full w-full overflow-visible"
        aria-label={aria_label}
      >
        {home_sdk_world_annotations.map((annotation) => {
          const visible = active_step >= annotation.visible_step;
          const emphasis = get_group_emphasis(active_file, get_boundary_group(annotation.boundary_key));
          const anchor = get_home_sdk_world_center(annotation.q, annotation.row);
          const boundary_paths = get_home_sdk_world_boundary_paths(annotation.boundary_key, active_step);

          return (
            <motion.g key={annotation.boundary_key} initial={false} animate={{ opacity: visible ? emphasis : 0 }} transition={transition} aria-hidden={!visible}>
              {boundary_paths.map((path) => (
                <path
                  key={path}
                  d={path}
                  fill="none"
                  stroke={annotation.boundary_key === "federation"
                    ? "var(--sdk-map-federation-boundary)"
                    : "var(--sdk-map-city-boundary)"}
                  strokeWidth={annotation.boundary_key === "federation" ? 3.4 : 1.35}
                  strokeLinecap="round"
                />
              ))}
              <text x={anchor.x + annotation.offset_x} y={anchor.y + annotation.offset_y} textAnchor="middle" className="fill-[var(--sdk-world-foreground)] text-[8px] font-semibold uppercase">
                {labels[annotation.label_key]}
              </text>
            </motion.g>
          );
        })}

        {home_sdk_world_cells.filter((cell) => cell.key !== "workspace").map((cell) => (
          <WorldCell key={cell.key} cell={cell} active_step={active_step} emphasis={get_group_emphasis(active_file, cell.group)} label={get_cell_label(cell)} />
        ))}

        <motion.g
          initial={false}
          animate={active_step === 2
            ? { opacity: agent_emphasis, scale: 1, x: 64 }
            : active_step >= 3
              ? { opacity: agent_emphasis, scale: 1, x: 0 }
              : { opacity: 0, scale: 0.84, x: 64 }}
          transition={active_step === 2 || active_step === 3 ? { duration: reduce_motion ? 0 : 0.9, ease: [0.65, 0, 0.35, 1] } : transition}
          style={{ transformOrigin: `${workspace_center.x}px ${workspace_center.y}px` }}
          aria-hidden={active_step < 2}
        >
          <path
            d={home_world_hex_path(workspace_center.x, workspace_center.y, home_sdk_world_grid.radius)}
            fill="var(--sdk-map-origin)"
            fillOpacity="0.22"
            stroke="var(--sdk-map-origin)"
            strokeOpacity="0.76"
            strokeWidth="1.15"
          />
          <text x={workspace_center.x} y={workspace_center.y + 20} textAnchor="middle" className="fill-[var(--sdk-world-foreground)] text-[7px] font-medium">{labels.workspace}</text>
        </motion.g>

        <motion.g
          initial={false}
          animate={active_step === 2
            ? { opacity: agent_emphasis, scale: 1, x: -64, y: 0 }
            : active_step >= 3
              ? { opacity: agent_emphasis, scale: 1, x: 0, y: 0 }
              : { opacity: agent_emphasis, scale: 1, x: 0, y: 0 }}
          transition={active_step === 2 || active_step === 3 ? { duration: reduce_motion ? 0 : 0.9, ease: [0.65, 0, 0.35, 1] } : transition}
          style={{ transformOrigin: `${workspace_center.x}px ${workspace_center.y}px` }}
        >
          <AgentGhost x={workspace_center.x} y={workspace_center.y - 2} size={28} />
          <motion.text
            x={workspace_center.x}
            y={workspace_center.y - 31}
            textAnchor="middle"
            initial={false}
            animate={{ opacity: active_step <= 2 ? 1 : 0 }}
            transition={transition}
            className="fill-[var(--sdk-world-foreground)] text-[8px] font-semibold uppercase"
          >
            {labels.agent}
          </motion.text>
        </motion.g>
        <motion.g initial={false} animate={{ opacity: active_step >= 15 ? 1 : 0, x: active_step >= 15 ? 0 : -10 }} transition={transition} aria-hidden={active_step < 15}>
          <path d={`M${user_center.x} ${user_center.y + 28} V${user_center.y + 36}`} fill="none" stroke="var(--sdk-map-neighbor)" strokeWidth="1.2" strokeLinecap="round" />
          <path d={`M${user_center.x - 30} ${user_center.y + 36} h112 a7 7 0 0 1 7 7 v20 a7 7 0 0 1 -7 7 h-72 l-10 9 v-9 h-30 a7 7 0 0 1 -7 -7 v-20 a7 7 0 0 1 7 -7 Z`} fill="var(--sdk-world-background)" stroke="var(--sdk-map-neighbor)" strokeWidth="1.2" />
          <text x={user_center.x + 26} y={user_center.y + 57} textAnchor="middle" className="fill-[var(--sdk-world-foreground)] text-[5.8px] font-medium">{labels.user_prompt}</text>
        </motion.g>
        <motion.g
          initial={false}
          animate={{ opacity: active_step >= 16 ? 1 : 0, y: active_step >= 16 ? 0 : 8 }}
          transition={transition}
          aria-hidden={active_step < 16}
        >
          <path d={`M${workspace_center.x - 68} ${workspace_center.y - 74} h126 a7 7 0 0 1 7 7 v25 a7 7 0 0 1 -7 7 h-84 l-10 10 v-10 h-32 a7 7 0 0 1 -7 -7 v-25 a7 7 0 0 1 7 -7 Z`} fill="var(--sdk-map-origin)" fillOpacity="0.14" stroke="var(--sdk-map-origin)" strokeWidth="1.3" />
          <text x={workspace_center.x - 4} y={workspace_center.y - 50} textAnchor="middle" className="fill-[var(--sdk-world-foreground)] text-[5.8px] font-medium">{labels.agent_reply}</text>
        </motion.g>
      </motion.svg>
    </div>
  );
}

export default HomeSdkWorldMap;

/**
 * 首页 SDK 世界的滚动叙事地图。
 *
 * 地图以同一套轴向六边形网格表达 Agent、Workspace、Group、City 与 Federation。
 * Agent 与 Workspace 通过汇合表达一次运行上下文，Group 只在成员之间显示轻量状态，
 * 多座 City 紧凑分布并通过少量链接地块接入 Federation。
 */

import {
  IconBook2,
  IconBrain,
  IconChecklist,
  IconDatabase,
  IconMessages,
  IconServer,
  IconUserCircle,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import {
  get_home_sdk_world_boundary_paths,
  get_home_sdk_world_cell,
  get_home_sdk_world_center,
  home_sdk_world_annotations,
  home_sdk_world_cells,
  home_sdk_world_grid,
  home_sdk_world_group_member_keys,
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
  if (cell.tone === "link") return cell.link_accent ?? "var(--sdk-map-stroke)";
  if (cell.boundary_key === "origin_city") return "var(--sdk-map-origin)";
  if (cell.boundary_key === "neighbor_city") return "var(--sdk-map-neighbor)";
  if (cell.boundary_key === "third_city") return "var(--sdk-map-third)";
  return "var(--sdk-map-federation)";
}

/** 延续完整地图的轻填充语言，避免六边形成为厚重色块。 */
function get_cell_fill_opacity(cell: HomeSdkWorldCell) {
  if (cell.tone === "workspace") return 0.22;
  if (cell.tone === "plugin") return 0.14;
  if (cell.tone === "link") return 0.07;
  if (cell.content === "agent") return 0.16;
  if (cell.tone === "storage" || cell.tone === "transport") return 0.12;
  if (cell.tone === "service") return 0.16;
  if (cell.tone === "federation") return 0.13;
  return 0.12;
}

/** 所有地图 Ghost 使用同一尺寸，身份差异只由颜色表达。 */
const agent_ghost_size = 28;

/** 绘制保留在 City 内的 Ghost Agent。 */
function AgentGhost({ x, y, size, accent = "var(--sdk-map-origin)" }: {
  /** Ghost 水平中心。 */ x: number;
  /** Ghost 垂直中心。 */ y: number;
  /** Ghost 轮廓基准尺寸。 */ size: number;
  /** Ghost 身份色。 */ accent?: string;
}) {
  return (
    <g pointerEvents="none">
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

/** 地块名称只在 hover 或键盘 focus 时显示，避免地图常驻文字噪声。 */
function CellTooltip({ x, y, label, visible, accent }: {
  /** Tooltip 水平中心。 */ x: number;
  /** Tooltip 底部锚点。 */ y: number;
  /** 当前地块名称。 */ label: string;
  /** 是否显示 Tooltip。 */ visible: boolean;
  /** Tooltip 边框身份色。 */ accent: string;
}) {
  const reduce_motion = useReducedMotion();
  const width = Math.min(104, Math.max(36, label.length * 5.2 + 16));

  return (
    <motion.g
      initial={false}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 3 }}
      transition={{ duration: reduce_motion ? 0 : 0.14, ease: [0.16, 1, 0.3, 1] }}
      pointerEvents="none"
      aria-hidden="true"
    >
      <rect
        x={x - width / 2}
        y={y - 16}
        width={width}
        height={14}
        rx={7}
        fill="var(--sdk-world-background)"
        stroke={accent}
        strokeOpacity="0.72"
        strokeWidth="0.8"
      />
      <text
        x={x}
        y={y - 6.2}
        textAnchor="middle"
        className="select-none fill-[var(--sdk-world-foreground)] text-[6px] font-medium"
      >
        {label}
      </text>
    </motion.g>
  );
}

const plugin_icon = {
  skill: IconBook2,
  task: IconChecklist,
  web: IconWorld,
  memory: IconBrain,
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

/** 为领域单元绘制克制且可辨识的图标。 */
function UnitMark({ cell, x, y }: {
  /** 当前要绘制的领域地块。 */ cell: HomeSdkWorldCell;
  /** 图标水平中心。 */ x: number;
  /** 图标垂直中心。 */ y: number;
}) {
  const icon_props = {
    x: x - 8,
    y: y - 8,
    width: 16,
    height: 16,
    color: "var(--sdk-world-foreground)",
    strokeWidth: 1.35,
    "aria-hidden": true,
  } as const;

  if (cell.content === "storage") return <IconDatabase {...icon_props} />;
  if (cell.content === "transport") return <IconServer {...icon_props} />;
  return null;
}

/** 渲染轴向网格中的标准地块。 */
function WorldCell({ cell, active_step, emphasis, label }: {
  /** 地块的轴向布局事实。 */ cell: HomeSdkWorldCell;
  /** 当前滚动叙事步骤。 */ active_step: number;
  /** 当前文件对地块的强调程度。 */ emphasis: number;
  /** 地块内显示的本地化名称。 */ label: string | null;
}) {
  const reduce_motion = useReducedMotion();
  const [is_hovered, set_is_hovered] = useState(false);
  const center = get_home_sdk_world_center(cell.q, cell.row);
  const visible = active_step >= cell.visible_step;
  const fill = get_cell_fill(cell);
  const fill_opacity = get_cell_fill_opacity(cell);
  const reveal_order = home_sdk_world_cells
    .filter((candidate) => candidate.visible_step === cell.visible_step)
    .findIndex((candidate) => candidate.key === cell.key);
  const link_order = home_sdk_world_cells
    .filter((candidate) => candidate.tone === "link")
    .findIndex((candidate) => candidate.key === cell.key);
  const is_active_service = cell.tone === "service" && active_step === cell.visible_step;
  const is_active_link = cell.tone === "link" && active_step === 19;
  const pulse_fill = is_active_link && !reduce_motion
    ? [fill_opacity, 0.2, fill_opacity]
    : is_active_service && !reduce_motion
      ? [fill_opacity, 0.2, fill_opacity]
      : fill_opacity;

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
      aria-label={visible && label ? label : undefined}
      role={visible && label ? "img" : undefined}
      tabIndex={visible && label ? 0 : -1}
      onPointerEnter={() => set_is_hovered(true)}
      onPointerLeave={() => set_is_hovered(false)}
      onFocus={() => set_is_hovered(true)}
      onBlur={() => set_is_hovered(false)}
    >
      <motion.path
        d={home_world_hex_path(center.x, center.y, home_sdk_world_grid.radius)}
        fill={fill}
        stroke={is_hovered || cell.tone === "link" ? fill : is_active_service ? "var(--sdk-map-federation)" : "var(--sdk-map-stroke)"}
        strokeOpacity={is_hovered ? 0.82 : cell.tone === "link" ? 0.5 : is_active_service ? 0.82 : 1}
        strokeWidth={is_hovered ? 1.35 : is_active_service ? 1.1 : 0.85}
        animate={{ fillOpacity: pulse_fill }}
        transition={is_active_link
          ? { duration: 0.72, delay: Math.max(0, link_order) * 0.06, ease: "easeInOut" }
          : is_active_service
            ? { duration: 0.8, ease: "easeInOut" }
            : { duration: reduce_motion ? 0 : 0.14 }}
      />
      {(cell.content === "agent" || cell.content === "agent_workspace") && cell.agent_accent
        ? <AgentGhost x={center.x} y={center.y - 2} size={agent_ghost_size} accent={cell.agent_accent} />
        : null}
      {cell.content === "user" && cell.agent_accent
        ? <IconUserCircle x={center.x - 9} y={center.y - 11} width={18} height={18} color={cell.agent_accent} strokeWidth={1.4} aria-hidden="true" />
        : null}
      {cell.plugin_kind ? <PluginMark kind={cell.plugin_kind} x={center.x} y={center.y} /> : null}
      <UnitMark cell={cell} x={center.x} y={center.y} />
      {label ? (
        <CellTooltip
          x={center.x}
          y={center.y - home_sdk_world_grid.radius - 3}
          label={label}
          visible={visible && is_hovered}
          accent={fill}
        />
      ) : null}
    </motion.g>
  );
}

/** 用汇合动画表达 Agent 进入 Workspace 并创建运行上下文。 */
function AgentWorkspaceAssembly({ active_step, emphasis, labels }: {
  /** 当前滚动叙事步骤。 */ active_step: number;
  /** Agent 领域当前视觉权重。 */ emphasis: number;
  /** 地图本地化标签。 */ labels: HomeSdkWorldMapProps["labels"];
}) {
  const reduce_motion = useReducedMotion();
  const [is_workspace_hovered, set_is_workspace_hovered] = useState(false);
  const workspace_cell = get_home_sdk_world_cell("workspace");
  const center = get_home_sdk_world_center(workspace_cell.q, workspace_cell.row);
  const is_separated = active_step === 2;
  const merge_transition = {
    duration: reduce_motion ? 0 : 0.9,
    ease: [0.65, 0, 0.35, 1] as const,
  };

  return (
    <>
      <motion.g
        initial={false}
        animate={{
          opacity: active_step >= 2 ? emphasis : 0,
          scale: active_step >= 2 ? 1 : 0.84,
          x: active_step >= 3 ? 0 : 64,
        }}
        transition={merge_transition}
        style={{ transformOrigin: `${center.x}px ${center.y}px` }}
        aria-hidden={active_step < 2}
        aria-label={active_step >= 2 ? labels.workspace : undefined}
        role={active_step >= 2 ? "img" : undefined}
        tabIndex={active_step >= 2 ? 0 : -1}
        onPointerEnter={() => set_is_workspace_hovered(true)}
        onPointerLeave={() => set_is_workspace_hovered(false)}
        onFocus={() => set_is_workspace_hovered(true)}
        onBlur={() => set_is_workspace_hovered(false)}
      >
        <path
          d={home_world_hex_path(center.x, center.y, home_sdk_world_grid.radius)}
          fill="var(--sdk-map-origin)"
          fillOpacity="0.22"
          stroke="var(--sdk-map-origin)"
          strokeOpacity="0.76"
          strokeWidth="1.15"
        />
        <CellTooltip
          x={center.x}
          y={center.y - home_sdk_world_grid.radius - 3}
          label={labels.workspace}
          visible={active_step >= 2 && is_workspace_hovered}
          accent="var(--sdk-map-origin)"
        />
      </motion.g>

      <motion.g
        initial={false}
        animate={{ opacity: emphasis, scale: 1, x: is_separated ? -64 : 0, y: 0 }}
        transition={merge_transition}
        style={{ transformOrigin: `${center.x}px ${center.y}px` }}
      >
        <AgentGhost x={center.x} y={center.y - 2} size={agent_ghost_size} />
      </motion.g>

    </>
  );
}

/** 在相邻成员之间显示 Group 状态，不增加新的地块或包围轮廓。 */
function GroupStatus({ active_step, emphasis, labels }: {
  /** 当前滚动叙事步骤。 */ active_step: number;
  /** City 领域当前视觉权重。 */ emphasis: number;
  /** 地图本地化标签。 */ labels: HomeSdkWorldMapProps["labels"];
}) {
  const reduce_motion = useReducedMotion();
  const [is_hovered, set_is_hovered] = useState(false);
  const member_centers = home_sdk_world_group_member_keys.map((key) => {
    const cell = get_home_sdk_world_cell(key);
    return get_home_sdk_world_center(cell.q, cell.row);
  });
  const center = {
    x: member_centers.reduce((sum, item) => sum + item.x, 0) / member_centers.length,
    y: member_centers.reduce((sum, item) => sum + item.y, 0) / member_centers.length,
  };
  const visible = active_step >= 8;
  const session_visible = active_step >= 9;
  const label = session_visible ? labels.group_session : labels.group;

  return (
    <motion.g
      initial={false}
      animate={{ opacity: visible ? emphasis : 0, scale: visible ? 1 : 0.92 }}
      transition={{ duration: reduce_motion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: `${center.x}px ${center.y}px` }}
      aria-hidden={!visible}
      aria-label={visible ? label : undefined}
      role={visible ? "img" : undefined}
      tabIndex={visible ? 0 : -1}
      onPointerEnter={() => set_is_hovered(true)}
      onPointerLeave={() => set_is_hovered(false)}
      onFocus={() => set_is_hovered(true)}
      onBlur={() => set_is_hovered(false)}
    >
      <circle
        cx={center.x}
        cy={center.y}
        r="9"
        fill="var(--sdk-world-background)"
        stroke="var(--sdk-map-origin)"
        strokeOpacity={is_hovered ? 0.88 : 0.46}
        strokeWidth={is_hovered ? 1.3 : 0.9}
      />
      <motion.g
        initial={false}
        animate={{ opacity: session_visible ? 0 : 0.78, scale: session_visible ? 0.72 : 1 }}
        transition={{ duration: reduce_motion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: `${center.x}px ${center.y}px` }}
        pointerEvents="none"
      >
        <IconUsersGroup x={center.x - 5} y={center.y - 5} width={10} height={10} color="var(--sdk-map-origin)" strokeWidth={1.35} aria-hidden="true" />
      </motion.g>
      <motion.g
        initial={false}
        animate={{ opacity: session_visible ? 0.9 : 0, scale: session_visible ? 1 : 0.72 }}
        transition={{ duration: reduce_motion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: `${center.x}px ${center.y}px` }}
        pointerEvents="none"
      >
        <IconMessages x={center.x - 5} y={center.y - 5} width={10} height={10} color="var(--sdk-map-origin)" strokeWidth={1.4} aria-hidden="true" />
      </motion.g>
      <CellTooltip
        x={center.x}
        y={center.y - 15}
        label={label}
        visible={visible && is_hovered}
        accent="var(--sdk-map-origin)"
      />
    </motion.g>
  );
}

/** 根据当前代码文件返回地图领域的视觉权重。 */
function get_group_emphasis(active_file: HomeSdkFileKey, group: HomeSdkWorldCell["group"]) {
  if (active_file === group) return 1;
  if (active_file === "agent" && group === "city") return 0.76;
  if (active_file === "city" && group === "agent") return 0.82;
  if (active_file === "agent" && group === "link") return 0.84;
  if (active_file === "federation" && group === "link") return 0.82;
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
  const group_member_centers = home_sdk_world_group_member_keys.map((key) => {
    const cell = get_home_sdk_world_cell(key);
    return get_home_sdk_world_center(cell.q, cell.row);
  });
  const group_center = {
    x: group_member_centers.reduce((sum, item) => sum + item.x, 0) / group_member_centers.length,
    y: group_member_centers.reduce((sum, item) => sum + item.y, 0) / group_member_centers.length,
  };
  const camera_view_box = active_step <= 5
    ? "30 70 260 260"
    : active_step <= 9
      ? "20 35 360 340"
      : active_step === 10
        ? "20 10 430 400"
        : active_step === 11
          ? "20 0 450 440"
          : "20 0 540 440";

  const get_cell_label = (cell: HomeSdkWorldCell) => {
    if (!cell.label_key) return null;
    if (cell.label_key !== "service") return labels[cell.label_key];
    return `${labels.service} ${cell.key.split("_").at(-1)}`;
  };

  return (
    <div className="relative h-full min-h-0 w-full min-w-0" aria-label={aria_label}>
      <motion.svg
        viewBox="20 0 540 440"
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

        <AgentWorkspaceAssembly active_step={active_step} emphasis={get_group_emphasis(active_file, "agent")} labels={labels} />
        <GroupStatus active_step={active_step} emphasis={get_group_emphasis(active_file, "city")} labels={labels} />

        <motion.g initial={false} animate={{ opacity: active_step === 20 ? 1 : 0, x: active_step === 20 ? 0 : -10 }} transition={transition} aria-hidden={active_step !== 20}>
          <path d={`M${user_center.x} ${user_center.y + 25} V${user_center.y + 33}`} fill="none" stroke="var(--sdk-map-neighbor)" strokeWidth="1.2" strokeLinecap="round" />
          <path d={`M${user_center.x - 16} ${user_center.y + 33} h128 a7 7 0 0 1 7 7 v20 a7 7 0 0 1 -7 7 h-88 l-10 9 v-9 h-30 a7 7 0 0 1 -7 -7 v-20 a7 7 0 0 1 7 -7 Z`} fill="var(--sdk-world-background)" stroke="var(--sdk-map-neighbor)" strokeWidth="1.2" />
          <text x={user_center.x + 43} y={user_center.y + 54} textAnchor="middle" className="fill-[var(--sdk-world-foreground)] text-[5.8px] font-medium">{labels.user_prompt}</text>
        </motion.g>

        <motion.g initial={false} animate={{ opacity: active_step === 20 ? 1 : 0, y: active_step === 20 ? 0 : 8 }} transition={transition} aria-hidden={active_step !== 20}>
          <path d={`M${workspace_center.x - 56} ${workspace_center.y - 70} h128 a7 7 0 0 1 7 7 v22 a7 7 0 0 1 -7 7 h-86 l-10 10 v-10 h-32 a7 7 0 0 1 -7 -7 v-22 a7 7 0 0 1 7 -7 Z`} fill="var(--sdk-map-origin)" fillOpacity="0.14" stroke="var(--sdk-map-origin)" strokeWidth="1.3" />
          <text x={workspace_center.x + 5} y={workspace_center.y - 47} textAnchor="middle" className="fill-[var(--sdk-world-foreground)] text-[5.8px] font-medium">{labels.agent_reply}</text>
        </motion.g>

        <motion.g initial={false} animate={{ opacity: active_step >= 21 ? 1 : 0, y: active_step >= 21 ? 0 : 8 }} transition={transition} aria-hidden={active_step < 21}>
          <path d={`M${group_center.x - 56} ${group_center.y - 66} h150 a7 7 0 0 1 7 7 v22 a7 7 0 0 1 -7 7 h-108 l-10 10 v-10 h-32 a7 7 0 0 1 -7 -7 v-22 a7 7 0 0 1 7 -7 Z`} fill="var(--sdk-map-origin)" fillOpacity="0.14" stroke="var(--sdk-map-origin)" strokeWidth="1.3" />
          <text x={group_center.x + 16} y={group_center.y - 43} textAnchor="middle" className="fill-[var(--sdk-world-foreground)] text-[5.5px] font-medium">{labels.group_prompt}</text>
        </motion.g>
      </motion.svg>
    </div>
  );
}

export default HomeSdkWorldMap;

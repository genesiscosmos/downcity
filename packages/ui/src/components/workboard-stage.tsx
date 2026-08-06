/**
 * Workboard 主舞台子组件与布局工具。
 *
 * 关键点（中文）
 * - 这里封装 Workboard game world 共用的空间布局与节点工具。
 * - 逻辑参考 teamprofile：先看全局簇，再进入局部簇内舞台。
 * - 具体 atlas / room renderer 已拆到独立文件，避免工具层继续混入场景组件。
 */

import { cn } from "../lib/utils";
import { WorkboardPixelAgent } from "./workboard-pixel-agent";
import {
  WORKBOARD_FOCUSED_PATROL_ROUTES,
  WORKBOARD_FOCUSED_STATIONS_BY_ZONE,
} from "./workboard-room-layout";
import {
  WORKBOARD_VILLAGE_PLAZA_POINT,
  WORKBOARD_ZONE_GATE_POINTS,
  WORKBOARD_ZONE_LAYOUT,
} from "./workboard-stage-map";
import type {
  DowncityWorkboardAgentItem,
  DowncityWorkboardProps,
} from "../types/workboard";
import type {
  DowncityWorkboardFocusedStageNode,
  DowncityWorkboardHoverTag,
  DowncityWorkboardMotionFrame,
  DowncityWorkboardStageNode,
  DowncityWorkboardStagePoint,
  DowncityWorkboardZoneAgentPlacement,
  DowncityWorkboardZoneDefinition,
  DowncityWorkboardZoneId,
} from "../types/workboard-stage";

export const WORKBOARD_STAGE_HEIGHT = 960;
export const WORKBOARD_STAGE_WIDTH = 1600;

const NODE_PLACEMENTS: DowncityWorkboardZoneAgentPlacement[] = [
  { left: 18, top: 26, delay: 0.0 },
  { left: 42, top: 19, delay: 0.4 },
  { left: 66, top: 29, delay: 0.8 },
  { left: 29, top: 54, delay: 1.2 },
  { left: 57, top: 56, delay: 1.6 },
  { left: 75, top: 47, delay: 2.0 },
  { left: 14, top: 70, delay: 2.4 },
  { left: 46, top: 74, delay: 2.8 },
];

export const WORKBOARD_ZONE_DEFINITIONS: DowncityWorkboardZoneDefinition[] = [
  {
    id: "engaged",
    title: "展开中",
    subtitle: "active field",
    description: "当前对外最有动势的一组 agent。",
    badge: "Live",
    areaClassName:
      "bg-[linear-gradient(145deg,rgba(238,248,244,0.92),rgba(248,251,249,0.78))]",
    borderClassName: "border-emerald-300/65",
    glowClassName:
      "bg-[radial-gradient(circle,rgba(52,144,111,0.18),transparent_70%)]",
    nodeClassName:
      "border-emerald-300/70 bg-[linear-gradient(145deg,rgba(248,252,250,0.98),rgba(235,247,242,0.94))]",
    lineClassName: "stroke-emerald-400/55",
  },
  {
    id: "steady",
    title: "持续推进",
    subtitle: "steady lane",
    description: "处于稳定节奏，持续向前推进的一组 agent。",
    badge: "Steady",
    areaClassName:
      "bg-[linear-gradient(145deg,rgba(244,246,236,0.9),rgba(252,250,244,0.75))]",
    borderClassName: "border-lime-300/60",
    glowClassName:
      "bg-[radial-gradient(circle,rgba(151,169,72,0.16),transparent_72%)]",
    nodeClassName:
      "border-lime-300/65 bg-[linear-gradient(145deg,rgba(252,252,247,0.98),rgba(243,246,233,0.95))]",
    lineClassName: "stroke-lime-400/50",
  },
  {
    id: "quiet",
    title: "静候中",
    subtitle: "quiet deck",
    description: "暂时安静、等待下一次触发的一组 agent。",
    badge: "Quiet",
    areaClassName:
      "bg-[linear-gradient(145deg,rgba(244,243,239,0.92),rgba(251,250,248,0.76))]",
    borderClassName: "border-stone-300/65",
    glowClassName:
      "bg-[radial-gradient(circle,rgba(130,124,112,0.14),transparent_72%)]",
    nodeClassName:
      "border-stone-300/65 bg-[linear-gradient(145deg,rgba(252,251,249,0.98),rgba(241,239,234,0.96))]",
    lineClassName: "stroke-stone-400/50",
  },
  {
    id: "drift",
    title: "轻微波动",
    subtitle: "watch deck",
    description: "出现中断、告警或需要重新观察的一组 agent。",
    badge: "Watch",
    areaClassName:
      "bg-[linear-gradient(145deg,rgba(251,241,235,0.92),rgba(252,248,244,0.76))]",
    borderClassName: "border-amber-300/70",
    glowClassName:
      "bg-[radial-gradient(circle,rgba(194,121,55,0.18),transparent_72%)]",
    nodeClassName:
      "border-amber-300/70 bg-[linear-gradient(145deg,rgba(253,250,245,0.98),rgba(249,239,229,0.95))]",
    lineClassName: "stroke-amber-400/55",
  },
];

function createHoverTag(params: {
  id: string;
  label: string;
  point: DowncityWorkboardStagePoint;
}): DowncityWorkboardHoverTag {
  return {
    id: params.id,
    label: params.label,
    x: params.point.x,
    y: params.point.y,
  };
}

/**
 * 将公开 agent 状态压缩成像素游戏中的小状态符号。
 */
function resolveAgentGlyph(item: DowncityWorkboardAgentItem): {
  label: string;
  className: string;
} {
  const hasIssue =
    item.snapshot.current.some((entry) => entry.status === "issue") ||
    item.snapshot.recent.some((entry) => entry.status === "issue") ||
    item.snapshot.signals.some((entry) => entry.tone === "warning");

  if (hasIssue) {
    return {
      label: "!",
      className: "border-amber-700/50 bg-amber-400 text-amber-950",
    };
  }

  if (item.snapshot.current.some((entry) => entry.status === "active")) {
    return {
      label: ">",
      className: "border-emerald-700/45 bg-emerald-400 text-emerald-950",
    };
  }

  if (item.running) {
    return {
      label: "~",
      className: "border-lime-700/45 bg-lime-300 text-lime-950",
    };
  }

  return {
    label: ".",
    className: "border-stone-500/45 bg-stone-300 text-stone-800",
  };
}

export function resolveZoneId(item: DowncityWorkboardAgentItem): DowncityWorkboardZoneId {
  const hasIssue =
    item.snapshot.current.some((entry) => entry.status === "issue") ||
    item.snapshot.recent.some((entry) => entry.status === "issue") ||
    item.snapshot.signals.some((entry) => entry.tone === "warning");
  if (hasIssue) return "drift";

  const hasActive = item.snapshot.current.some((entry) => entry.status === "active");
  if (hasActive) return "engaged";

  const hasRecentMotion =
    item.running &&
    (item.snapshot.current.length > 0 || item.snapshot.recent.length > 0 || item.currentCount > 0);
  if (hasRecentMotion) return "steady";

  return "quiet";
}

export function resolveZoneDefinition(
  zoneId: DowncityWorkboardZoneId,
): DowncityWorkboardZoneDefinition {
  return WORKBOARD_ZONE_DEFINITIONS.find((item) => item.id === zoneId) || WORKBOARD_ZONE_DEFINITIONS[0];
}

export function formatWorkboardRelativeTime(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const delta = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(delta / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function buildWorkboardTilePath(params: {
  from: { x: number; y: number };
  to: { x: number; y: number };
}): string {
  const midX = params.from.x + (params.to.x - params.from.x) * 0.5;
  // 关键节点：像素小镇路线必须沿水平/垂直 tile 行走，不能用普通 UI 的曲线连线。
  return `M ${params.from.x} ${params.from.y} H ${midX} V ${params.to.y} H ${params.to.x}`;
}

export function toStagePoint(
  zoneId: DowncityWorkboardZoneId,
  placement: DowncityWorkboardZoneAgentPlacement,
): DowncityWorkboardStagePoint {
  const zone = WORKBOARD_ZONE_LAYOUT[zoneId];
  const left = zone.x + (zone.w * placement.left) / 100;
  const top = zone.y + (zone.h * placement.top) / 100;
  return {
    x: (left / 100) * WORKBOARD_STAGE_WIDTH,
    y: (top / 100) * WORKBOARD_STAGE_HEIGHT,
  };
}

export function toZoneHubPoint(zoneId: DowncityWorkboardZoneId): DowncityWorkboardStagePoint {
  const zone = WORKBOARD_ZONE_LAYOUT[zoneId];
  return {
    x: (zone.hubX / 100) * WORKBOARD_STAGE_WIDTH,
    y: (zone.hubY / 100) * WORKBOARD_STAGE_HEIGHT,
  };
}

export function deriveStageNodes(
  board: DowncityWorkboardProps["board"],
): DowncityWorkboardStageNode[] {
  const items = board?.agents || [];
  const buckets = new Map<DowncityWorkboardZoneId, DowncityWorkboardAgentItem[]>();

  items.forEach((item) => {
    const zoneId = resolveZoneId(item);
    const group = buckets.get(zoneId) || [];
    group.push(item);
    buckets.set(zoneId, group);
  });

  return WORKBOARD_ZONE_DEFINITIONS.flatMap((zone) => {
    const group = buckets.get(zone.id) || [];
    return group.map((item, index) => ({
      item,
      zone,
      placement: NODE_PLACEMENTS[index % NODE_PLACEMENTS.length],
    }));
  });
}

export function deriveFocusedClusterNodes(
  items: DowncityWorkboardAgentItem[],
  zoneId: DowncityWorkboardZoneId,
): DowncityWorkboardFocusedStageNode[] {
  const stations = WORKBOARD_FOCUSED_STATIONS_BY_ZONE[zoneId];
  return items.map((item, index) => {
    const station = stations[index % stations.length];
    return {
      item,
      x: station.x,
      y: station.y,
      delay: index * 0.18,
    };
  });
}

export function buildOverviewPatrolRoute(params: {
  zoneId: DowncityWorkboardZoneId;
  placement: DowncityWorkboardZoneAgentPlacement;
}): DowncityWorkboardStagePoint[] {
  const anchor = toStagePoint(params.zoneId, params.placement);
  const hub = toZoneHubPoint(params.zoneId);
  const city = WORKBOARD_ZONE_GATE_POINTS[params.zoneId];
  const laneIndex = Math.round((params.placement.left + params.placement.top) / 32) % 3;
  const laneOffset = (laneIndex - 1) * 10;
  const roadY = params.zoneId === "engaged" || params.zoneId === "steady" ? 460 : 500;
  const plazaLane = {
    x: WORKBOARD_VILLAGE_PLAZA_POINT.x + laneOffset,
    y: WORKBOARD_VILLAGE_PLAZA_POINT.y + (roadY < WORKBOARD_VILLAGE_PLAZA_POINT.y ? -10 : 10),
  };

  // 关键节点：overview 使用正交 tile 路径，避免 sprite 穿过建筑或草地。
  return [
    anchor,
    { x: anchor.x, y: hub.y },
    hub,
    { x: city.x, y: hub.y },
    city,
    { x: city.x, y: roadY },
    { x: plazaLane.x, y: roadY },
    plazaLane,
    WORKBOARD_VILLAGE_PLAZA_POINT,
    plazaLane,
    { x: plazaLane.x, y: roadY },
    { x: city.x, y: roadY },
    city,
    { x: city.x, y: hub.y },
    hub,
    { x: anchor.x, y: hub.y },
    anchor,
  ];
}

export function buildFocusedPatrolRoute(params: {
  index: number;
  zoneId: DowncityWorkboardZoneId;
}): DowncityWorkboardStagePoint[] {
  const routes = WORKBOARD_FOCUSED_PATROL_ROUTES[params.zoneId];
  // 关键节点：room 的巡游路线跟随具体建筑布局，避免所有子地图共享同一条抽象动线。
  return routes[params.index % routes.length];
}

export function WorkboardStageZone(props: {
  zone: DowncityWorkboardZoneDefinition;
  count: number;
  active: boolean;
  onSelect?: (zoneId: DowncityWorkboardZoneId) => void;
  onHoverChange?: (tag: DowncityWorkboardHoverTag | null) => void;
}) {
  const layout = WORKBOARD_ZONE_LAYOUT[props.zone.id];
  const hubPoint = {
    x: (layout.hubX / 100) * WORKBOARD_STAGE_WIDTH,
    y: (layout.hubY / 100) * WORKBOARD_STAGE_HEIGHT,
  };

  return (
    <button
      type="button"
      onClick={() => props.onSelect?.(props.zone.id)}
      onMouseEnter={() =>
        props.onHoverChange?.(
          createHoverTag({
            id: `zone-${props.zone.id}`,
            label: `${props.zone.title} · ${props.count}`,
            point: { x: hubPoint.x + 24, y: hubPoint.y - 18 },
          }),
        )
      }
      onMouseLeave={() => props.onHoverChange?.(null)}
      onFocus={() =>
        props.onHoverChange?.(
          createHoverTag({
            id: `zone-${props.zone.id}`,
            label: `${props.zone.title} · ${props.count}`,
            point: { x: hubPoint.x + 24, y: hubPoint.y - 18 },
          }),
        )
      }
      onBlur={() => props.onHoverChange?.(null)}
      className="absolute z-10 bg-transparent text-left focus:outline-none"
      aria-label={`${props.zone.title} ${props.count}`}
      style={{
        left: `${layout.x}%`,
        top: `${layout.y}%`,
        width: `${layout.w}%`,
        height: `${layout.h}%`,
        clipPath: "polygon(0 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) calc(100% - 16px),calc(100% - 16px) 100%,0 100%)",
      }}
    />
  );
}

export function WorkboardStageAgentNode(props: {
  item: DowncityWorkboardAgentItem;
  zone: DowncityWorkboardZoneDefinition;
  point: DowncityWorkboardStagePoint | DowncityWorkboardMotionFrame;
  active: boolean;
  faded: boolean;
  mode: "overview" | "focused";
  onSelect?: (agentId: string) => void;
  onHoverChange?: (tag: DowncityWorkboardHoverTag | null) => void;
}) {
  const compact = props.mode === "overview";
  const avatarSize = compact ? 28 : 36;
  const direction = "direction" in props.point ? props.point.direction : undefined;
  const walking = "state" in props.point ? props.point.state === "walking" : false;
  const glyph = resolveAgentGlyph(props.item);

  return (
    <button
      type="button"
      onClick={() => props.onSelect?.(props.item.id)}
      onMouseEnter={() =>
        props.onHoverChange?.(
          createHoverTag({
            id: `agent-${props.item.id}`,
            label: `${props.item.name} · ${props.item.posture}`,
            point: props.point,
          }),
        )
      }
      onMouseLeave={() => props.onHoverChange?.(null)}
      onFocus={() =>
        props.onHoverChange?.(
          createHoverTag({
            id: `agent-${props.item.id}`,
            label: `${props.item.name} · ${props.item.posture}`,
            point: props.point,
          }),
        )
      }
      onBlur={() => props.onHoverChange?.(null)}
      className={cn(
        "group absolute z-20 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 focus:outline-none",
        props.active
          ? "scale-[1.08]"
          : "hover:scale-[1.04] focus-visible:scale-[1.04]",
        props.faded ? "opacity-30 saturate-50" : "opacity-100",
      )}
      style={{
        left: props.point.x,
        top: props.point.y,
      }}
      aria-label={props.item.name}
    >
      <span className="relative block">
        {props.active ? (
          <>
            <span
              className="pointer-events-none absolute -inset-2 border border-foreground/45"
              style={{ animation: "workboard-pulse 1.6s steps(2, end) infinite" }}
            />
            <span className="pointer-events-none absolute -left-1 -top-1 h-1.5 w-1.5 bg-foreground/70" />
            <span className="pointer-events-none absolute -right-1 -bottom-1 h-1.5 w-1.5 bg-foreground/60" />
          </>
        ) : null}
        {!props.active && !props.faded ? (
          <span className="pointer-events-none absolute -inset-1 border border-foreground/22 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
        ) : null}
        <WorkboardPixelAgent
          agentId={props.item.id}
          name={props.item.name}
          size={avatarSize}
          active={props.active}
          faded={props.faded}
          direction={direction}
          walking={walking}
          className={cn(
            props.active ? "shadow-[0_0_0_1px_rgba(17,17,19,0.14),0_3px_0_rgba(17,17,19,0.22)]" : "",
            compact ? "" : "scale-[1.03]",
          )}
        />
        <span
          className={cn(
            "absolute -bottom-1 -right-1 grid size-3 place-items-center border text-[8px] font-bold leading-none",
            glyph.className,
          )}
          aria-hidden="true"
        >
          {glyph.label}
        </span>
      </span>
    </button>
  );
}

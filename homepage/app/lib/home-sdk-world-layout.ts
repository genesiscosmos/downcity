/**
 * 首页 SDK 世界的轴向六边形布局。
 *
 * 所有 City、Embassy 与 Federation 共用同一个网格原点和地块半径。布局模块是
 * 地图几何的唯一事实源，并从区域内真实地块推导外露边，避免渲染层手写近似边界。
 */

import { home_world_hex_center } from "@/lib/home-world-geometry";
import type {
  HomeSdkWorldAnnotation,
  HomeSdkWorldBoundaryKey,
  HomeSdkWorldCell,
} from "@/types/home/HomeSdkWorld";

/** SDK 世界共享的网格原点与统一地块尺寸。 */
export const home_sdk_world_grid = {
  origin_x: 160,
  origin_y: 220,
  radius: 28,
} as const;

const hex_directions = [
  { q: -1, row: 0 },
  { q: 0, row: -1 },
  { q: 1, row: -1 },
  { q: 1, row: 0 },
  { q: 0, row: 1 },
  { q: -1, row: 1 },
] as const;

/** 地块按相邻坐标生长；任何区域都不能脱离这份布局单独使用像素坐标。 */
export const home_sdk_world_cells: readonly HomeSdkWorldCell[] = [
  { key: "workspace", q: 0, row: 0, visible_step: 2, group: "agent", boundary_key: "origin_city", tone: "workspace", content: "primary_agent", label_key: "workspace", agent_accent: "var(--sdk-map-origin)", portal_accent: null },
  { key: "plugin_north", q: 0, row: -1, visible_step: 5, group: "agent", boundary_key: "origin_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "skill" },
  { key: "plugin_north_west", q: -1, row: 0, visible_step: 5, group: "agent", boundary_key: "origin_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "task" },
  { key: "plugin_south_west", q: -1, row: 1, visible_step: 5, group: "agent", boundary_key: "origin_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "memory" },
  { key: "plugin_south", q: 0, row: 1, visible_step: 5, group: "agent", boundary_key: "origin_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "sound" },
  { key: "plugin_south_east", q: 1, row: 0, visible_step: 5, group: "agent", boundary_key: "origin_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "image" },
  { key: "plugin_north_east", q: 1, row: -1, visible_step: 5, group: "agent", boundary_key: "origin_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "web" },
  { key: "origin_agent_west", q: -2, row: 1, visible_step: 6, group: "city", boundary_key: "origin_city", tone: "city", content: "agent", label_key: null, agent_accent: "var(--sdk-map-third)", portal_accent: null },
  { key: "origin_user", q: -3, row: 1, visible_step: 15, group: "city", boundary_key: "origin_city", tone: "city", content: "user", label_key: "user", agent_accent: "var(--sdk-map-neighbor)", portal_accent: null },
  { key: "origin_agent_east", q: 2, row: -1, visible_step: 6, group: "city", boundary_key: "origin_city", tone: "city", content: "agent", label_key: null, agent_accent: "var(--sdk-map-neighbor)", portal_accent: null },
  { key: "origin_agent_south", q: 0, row: 2, visible_step: 6, group: "city", boundary_key: "origin_city", tone: "city", content: "agent", label_key: null, agent_accent: "var(--sdk-map-origin)", portal_accent: null },
  { key: "origin_embassy", q: 2, row: 0, visible_step: 9, group: "embassy", boundary_key: "origin_city", tone: "embassy", content: "none", label_key: "embassy", agent_accent: null, portal_accent: "var(--sdk-map-origin)" },

  { key: "neighbor_workspace", q: 4, row: -4, visible_step: 7, group: "city", boundary_key: "neighbor_city", tone: "city", content: "agent", label_key: null, agent_accent: "var(--sdk-map-neighbor)", portal_accent: null },
  { key: "neighbor_north", q: 4, row: -5, visible_step: 7, group: "city", boundary_key: "neighbor_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "skill" },
  { key: "neighbor_west", q: 3, row: -4, visible_step: 7, group: "city", boundary_key: "neighbor_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "web" },
  { key: "neighbor_south_west", q: 3, row: -3, visible_step: 7, group: "city", boundary_key: "neighbor_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "image" },
  { key: "neighbor_south", q: 4, row: -3, visible_step: 7, group: "city", boundary_key: "neighbor_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "task" },
  { key: "neighbor_east", q: 5, row: -4, visible_step: 7, group: "city", boundary_key: "neighbor_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "memory" },
  { key: "neighbor_embassy", q: 5, row: -5, visible_step: 9, group: "embassy", boundary_key: "neighbor_city", tone: "embassy", content: "none", label_key: "embassy", agent_accent: null, portal_accent: "var(--sdk-map-neighbor)" },

  { key: "third_workspace", q: 4, row: 0, visible_step: 8, group: "city", boundary_key: "third_city", tone: "city", content: "agent", label_key: null, agent_accent: "var(--sdk-map-third)", portal_accent: null },
  { key: "third_north", q: 4, row: -1, visible_step: 8, group: "city", boundary_key: "third_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "memory" },
  { key: "third_west", q: 3, row: 0, visible_step: 8, group: "city", boundary_key: "third_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "task" },
  { key: "third_south_west", q: 3, row: 1, visible_step: 8, group: "city", tone: "plugin", boundary_key: "third_city", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "sound" },
  { key: "third_south", q: 4, row: 1, visible_step: 8, group: "city", boundary_key: "third_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "skill" },
  { key: "third_east", q: 5, row: 0, visible_step: 8, group: "city", boundary_key: "third_city", tone: "plugin", content: "none", label_key: "plugin", agent_accent: null, portal_accent: null, plugin_kind: "web" },
  { key: "third_embassy", q: 5, row: -1, visible_step: 9, group: "embassy", boundary_key: "third_city", tone: "embassy", content: "none", label_key: "embassy", agent_accent: null, portal_accent: "var(--sdk-map-third)" },

  { key: "federation_model", q: 9, row: -4, visible_step: 10, group: "federation", boundary_key: "federation", tone: "federation", content: "none", label_key: "model", agent_accent: null, portal_accent: null },
  { key: "federation_embassy_origin", q: 9, row: -5, visible_step: 14, group: "federation", boundary_key: "federation", tone: "embassy", content: "none", label_key: "embassy", agent_accent: null, portal_accent: "var(--sdk-map-origin)" },
  { key: "federation_account", q: 10, row: -5, visible_step: 11, group: "federation", boundary_key: "federation", tone: "service", content: "none", label_key: "account", agent_accent: null, portal_accent: null },
  { key: "federation_payment", q: 10, row: -4, visible_step: 12, group: "federation", boundary_key: "federation", tone: "service", content: "none", label_key: "payment", agent_accent: null, portal_accent: null },
  { key: "federation_embassy_neighbor", q: 8, row: -3, visible_step: 14, group: "federation", boundary_key: "federation", tone: "embassy", content: "none", label_key: "embassy", agent_accent: null, portal_accent: "var(--sdk-map-neighbor)" },
  { key: "federation_credits", q: 9, row: -3, visible_step: 13, group: "federation", boundary_key: "federation", tone: "service", content: "none", label_key: "credits", agent_accent: null, portal_accent: null },
  { key: "federation_embassy_third", q: 8, row: -4, visible_step: 14, group: "federation", boundary_key: "federation", tone: "embassy", content: "none", label_key: "embassy", agent_accent: null, portal_accent: "var(--sdk-map-third)" },
] as const;

/** 区域名称同样锚定网格坐标，只保留排版所需的小幅像素偏移。 */
export const home_sdk_world_annotations: readonly HomeSdkWorldAnnotation[] = [
  { boundary_key: "origin_city", visible_step: 6, q: 0, row: 2, offset_x: 0, offset_y: 42, label_key: "city" },
  { boundary_key: "neighbor_city", visible_step: 7, q: 4, row: -5, offset_x: 0, offset_y: -35, label_key: "neighbor_city" },
  { boundary_key: "third_city", visible_step: 8, q: 4, row: 1, offset_x: 0, offset_y: 42, label_key: "third_city" },
  { boundary_key: "federation", visible_step: 10, q: 9, row: -5, offset_x: 21, offset_y: -35, label_key: "federation" },
] as const;

/** 把轴向坐标转换为当前地图使用的 SVG 中心点。 */
export function get_home_sdk_world_center(q: number, row: number) {
  return home_world_hex_center(
    home_sdk_world_grid.origin_x,
    home_sdk_world_grid.origin_y,
    home_sdk_world_grid.radius,
    q,
    row,
  );
}

/** 生成区域在当前步骤所有真实外露蜂巢边缘。 */
export function get_home_sdk_world_boundary_paths(boundary_key: HomeSdkWorldBoundaryKey, active_step: number) {
  const visible_cells = home_sdk_world_cells.filter((cell) =>
    cell.boundary_key === boundary_key && cell.visible_step <= active_step,
  );
  const visible_cell_keys = new Set(visible_cells.map((cell) => `${cell.q}:${cell.row}`));
  const radius = home_sdk_world_grid.radius;
  const height = radius * 0.866;

  return visible_cells.flatMap((cell) => {
    const center = get_home_sdk_world_center(cell.q, cell.row);
    const vertices = [
      { x: center.x - radius, y: center.y },
      { x: center.x - radius / 2, y: center.y - height },
      { x: center.x + radius / 2, y: center.y - height },
      { x: center.x + radius, y: center.y },
      { x: center.x + radius / 2, y: center.y + height },
      { x: center.x - radius / 2, y: center.y + height },
    ];

    return hex_directions.flatMap((direction, side) => {
      const neighbor_key = `${cell.q + direction.q}:${cell.row + direction.row}`;
      if (visible_cell_keys.has(neighbor_key)) return [];

      const start = vertices[side];
      const end = vertices[(side + 1) % vertices.length];
      return [`M${start.x} ${start.y} L${end.x} ${end.y}`];
    });
  });
}

/** 按稳定键读取连接线端点，布局变化时不需要同步手写像素坐标。 */
export function get_home_sdk_world_cell(key: string) {
  const cell = home_sdk_world_cells.find((candidate) => candidate.key === key);
  if (!cell) throw new Error(`Unknown SDK world cell: ${key}`);
  return cell;
}

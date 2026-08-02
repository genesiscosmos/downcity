/**
 * 首页 Product World 的连续蜂巢大陆布局。
 *
 * 大陆、City 与 Federation 共享同一套轴向六边形坐标。City 的形态、人口与
 * 地块内容由布局数据统一生成，所有边界均严格取自真实蜂巢边缘。
 */

import { home_world_hex_center } from "@/lib/home-world-geometry";

export const home_product_world_origin = {
  x: 600,
  y: 360,
  radius: 42,
} as const;

const continent_radius = 15;
const city_spacing = 4;

const coastline_radii = [
  15, 14, 14, 13, 15, 15,
  14, 12, 13, 14, 15, 13,
  14, 14, 15, 12, 13, 15,
  14, 13, 15, 14, 12, 14,
] as const;

const hex_directions = [
  { q: -1, row: 0 },
  { q: 0, row: -1 },
  { q: 1, row: -1 },
  { q: 1, row: 0 },
  { q: 0, row: 1 },
  { q: -1, row: 1 },
] as const;

const city_offsets = [
  { q: 0, row: 0 },
  { q: 1, row: 0 },
  { q: 0, row: -1 },
  { q: -1, row: 1 },
  { q: -1, row: 0 },
  { q: 0, row: 1 },
  { q: 1, row: -1 },
] as const;

/** 四种 City 性格决定人口密度、主色与内部地块语言。 */
const city_archetypes = [
  { key: "studio", accent: "#4f6f9f", agent_count: 5, fill_opacity: 0.055 },
  { key: "grove", accent: "#557b70", agent_count: 3, fill_opacity: 0.045 },
  { key: "works", accent: "#9a6b5d", agent_count: 3, fill_opacity: 0.05 },
  { key: "commons", accent: "#716a9f", agent_count: 4, fill_opacity: 0.04 },
] as const;

/** 计算两个轴向坐标之间的六边形距离。 */
function get_hex_distance(q_a: number, row_a: number, q_b: number, row_b: number) {
  return Math.max(
    Math.abs(q_a - q_b),
    Math.abs(row_a - row_b),
    Math.abs(q_a + row_a - q_b - row_b),
  );
}

const federation_origins = [
  { key: "atlas", q: 0, row: 0, weight: 11, bias: -8 },
  { key: "harbor", q: -2, row: 2, weight: 10, bias: 0 },
  { key: "summit", q: -1, row: -2, weight: 9.5, bias: 1 },
  { key: "meridian", q: 2, row: -1, weight: 10.5, bias: -1 },
] as const;

/**
 * 四个不对称核心通过距离、权重和局部扰动竞争 City。
 *
 * 扰动幅度小于相邻 City 的距离成本，因此 Federation 保持连续，同时避免
 * 规则扇区、对称分割和相近面积。
 */
function get_federation_key(q: number, row: number) {
  return federation_origins.reduce((nearest_origin, federation_origin, index) => {
    const nearest_index = federation_origins.indexOf(nearest_origin);
    const nearest_noise = (
      Math.abs(q * 17 + row * 31 + nearest_index * 13) * 7
    ) % 9 - 4;
    const current_noise = (
      Math.abs(q * 17 + row * 31 + index * 13) * 7
    ) % 9 - 4;
    const nearest_score = get_hex_distance(
      q,
      row,
      nearest_origin.q,
      nearest_origin.row,
    ) * nearest_origin.weight + nearest_origin.bias + nearest_noise;
    const current_score = get_hex_distance(
      q,
      row,
      federation_origin.q,
      federation_origin.row,
    ) * federation_origin.weight + federation_origin.bias + current_noise;

    return current_score < nearest_score ? federation_origin : nearest_origin;
  }, federation_origins[0]).key;
}

/** 外缘按方向使用不同半径，形成连续但不规则的海岸线。 */
function get_coastline_radius(q: number, row: number) {
  const angle = Math.atan2(row + q / 2, q * 0.866);
  const normalized_angle = (angle + Math.PI) / (Math.PI * 2);
  const radius_index = Math.min(
    coastline_radii.length - 1,
    Math.floor(normalized_angle * coastline_radii.length),
  );

  return coastline_radii[radius_index];
}

const macro_city_coordinates = Array.from({ length: 7 }, (_, q_index) => {
  const q = q_index - 3;

  return Array.from({ length: 7 }, (_, row_index) => ({
    q,
    row: row_index - 3,
  }));
}).flat().filter((coordinate) =>
  get_hex_distance(coordinate.q, coordinate.row, 0, 0) <= 3,
).sort((coordinate_a, coordinate_b) => {
  const distance_difference = get_hex_distance(
    coordinate_a.q,
    coordinate_a.row,
    0,
    0,
  ) - get_hex_distance(coordinate_b.q, coordinate_b.row, 0, 0);

  return distance_difference
    || coordinate_a.q - coordinate_b.q
    || coordinate_a.row - coordinate_b.row;
});

/** 37 个错位 City 中心让大陆分区具有紧凑、狭长与开放等不同轮廓。 */
export const home_product_world_city_seeds = macro_city_coordinates.map((coordinate, index) => {
  const offset = city_offsets[index % city_offsets.length];
  const archetype = city_archetypes[index % city_archetypes.length];

  return {
    key: index === 0 ? "origin" : `city_${index}`,
    federation: get_federation_key(coordinate.q, coordinate.row),
    q: coordinate.q * city_spacing + offset.q,
    row: coordinate.row * city_spacing + offset.row,
    city_type: archetype.key,
    accent: archetype.accent,
    agent_count: archetype.agent_count,
    fill_opacity: archetype.fill_opacity,
  };
});

/** 查找一个地块所属的最近 City。 */
function get_nearest_city_seed(q: number, row: number) {
  return home_product_world_city_seeds.reduce((nearest_seed, city_seed) => {
    const nearest_distance = get_hex_distance(q, row, nearest_seed.q, nearest_seed.row);
    const city_distance = get_hex_distance(q, row, city_seed.q, city_seed.row);

    return city_distance < nearest_distance ? city_seed : nearest_seed;
  }, home_product_world_city_seeds[0]);
}

const continent_coordinates = Array.from(
  { length: continent_radius * 2 + 1 },
  (_, q_index) => {
    const q = q_index - continent_radius;

    return Array.from({ length: continent_radius * 2 + 1 }, (_, row_index) => ({
      q,
      row: row_index - continent_radius,
    }));
  },
).flat().filter((coordinate) =>
  get_hex_distance(coordinate.q, coordinate.row, 0, 0)
    <= get_coastline_radius(coordinate.q, coordinate.row),
);

const assigned_cells = continent_coordinates.map((coordinate) => {
  const city_seed = get_nearest_city_seed(coordinate.q, coordinate.row);

  return {
    key: `${coordinate.q}:${coordinate.row}`,
    q: coordinate.q,
    row: coordinate.row,
    city_seed,
  };
});

const agent_cell_keys = new Set(home_product_world_city_seeds.flatMap((city_seed) =>
  assigned_cells
    .filter((cell) => cell.city_seed.key === city_seed.key)
    .sort((cell_a, cell_b) => {
      const distance_difference = get_hex_distance(
        cell_a.q,
        cell_a.row,
        city_seed.q,
        city_seed.row,
      ) - get_hex_distance(cell_b.q, cell_b.row, city_seed.q, city_seed.row);
      const hash_a = Math.abs(cell_a.q * 17 + cell_a.row * 31);
      const hash_b = Math.abs(cell_b.q * 17 + cell_b.row * 31);

      return distance_difference || hash_a - hash_b;
    })
    .slice(0, city_seed.agent_count)
    .map((cell) => cell.key),
));

/** 根据 City 性格生成具有差异的内部设施与地貌。 */
function get_cell_content(cell: (typeof assigned_cells)[number], index: number) {
  if (agent_cell_keys.has(cell.key)) return "agent";

  const residue = Math.abs(cell.q * 17 + cell.row * 31 + index * 7);
  if (cell.city_seed.city_type === "studio") {
    if (residue % 5 === 0) return "workshop";
    if (residue % 13 === 0) return "forest";
  }
  if (cell.city_seed.city_type === "grove") {
    if (residue % 4 === 0) return "forest";
    if (residue % 13 === 0) return "plaza";
  }
  if (cell.city_seed.city_type === "works") {
    if (residue % 4 === 0) return "building";
    if (residue % 9 === 0) return "workshop";
  }
  if (cell.city_seed.city_type === "commons") {
    if (residue % 5 === 0) return "plaza";
    if (residue % 9 === 0) return "building";
  }

  return "empty";
}

/** 一整块连续大陆上的全部地块。 */
export const home_product_world_cells = assigned_cells.map((cell, index) => {
  const distance = get_hex_distance(cell.q, cell.row, 0, 0);

  return {
    key: cell.key,
    q: cell.q,
    row: cell.row,
    city_key: cell.city_seed.key,
    city_type: cell.city_seed.city_type,
    federation: cell.city_seed.federation,
    accent: cell.city_seed.accent,
    fill_opacity: cell.city_seed.fill_opacity,
    growth_stage: Math.min(4, Math.floor(distance / 3)),
    content: get_cell_content(cell, index),
  };
});

/** 大陆从中心向外扩散的五层地块。 */
export const home_product_world_growth_groups = Array.from({ length: 5 }, (_, stage) =>
  home_product_world_cells.filter((cell) => cell.growth_stage === stage),
);

const cell_by_key = new Map(home_product_world_cells.map((cell) => [cell.key, cell]));

/** 生成某条六边形边缘的 SVG 线段。 */
function get_hex_edge_path(q: number, row: number, side: number) {
  const center = home_world_hex_center(
    home_product_world_origin.x,
    home_product_world_origin.y,
    home_product_world_origin.radius,
    q,
    row,
  );
  const radius = home_product_world_origin.radius;
  const height = radius * 0.866;
  const vertices = [
    { x: center.x - radius, y: center.y },
    { x: center.x - radius / 2, y: center.y - height },
    { x: center.x + radius / 2, y: center.y - height },
    { x: center.x + radius, y: center.y },
    { x: center.x + radius / 2, y: center.y + height },
    { x: center.x - radius / 2, y: center.y + height },
  ];
  const start = vertices[side];
  const end = vertices[(side + 1) % vertices.length];

  return `M${start.x} ${start.y} L${end.x} ${end.y}`;
}

/** City 的闭合边界直接使用归属发生变化的蜂巢边缘。 */
export const home_product_world_city_edges = home_product_world_cells.flatMap((cell) =>
  hex_directions.flatMap((direction, side) => {
    const neighbor = cell_by_key.get(`${cell.q + direction.q}:${cell.row + direction.row}`);

    if (neighbor?.city_key === cell.city_key) return [];
    if (neighbor && cell.key > neighbor.key) return [];

    return [get_hex_edge_path(cell.q, cell.row, side)];
  }),
);

/** Federation 的闭合粗边界直接使用归属发生变化的蜂巢边缘。 */
export const home_product_world_federation_edges = home_product_world_cells.flatMap((cell) =>
  hex_directions.flatMap((direction, side) => {
    const neighbor = cell_by_key.get(`${cell.q + direction.q}:${cell.row + direction.row}`);

    if (neighbor?.federation === cell.federation) return [];
    if (neighbor && cell.key > neighbor.key) return [];

    return [get_hex_edge_path(cell.q, cell.row, side)];
  }),
);

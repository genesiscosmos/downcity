/**
 * 首页 Product World 的连续蜂巢大陆布局。
 *
 * 大陆、City 与 Federation 共享同一套轴向六边形坐标。City 的形态、人口与
 * 地块内容由布局数据统一生成，所有边界均严格取自真实蜂巢边缘。
 */

import { home_world_hex_center } from "@/lib/home-world-geometry";
import type {
  HomeProductWorldAnnotation,
  HomeProductWorldCell,
  HomeProductWorldFeatureKey,
  HomeProductWorldTerrainKind,
} from "@/types/home/HomeProductWorld";

export const home_product_world_origin = {
  x: 600,
  y: 360,
  radius: 42,
} as const;

const continent_radius = 23;
const city_spacing = 4;

const coastline_radii = [
  23, 23, 22, 22, 23, 23,
  23, 22, 23, 23, 22, 22,
  23, 23, 23, 22, 23, 23,
  23, 22, 23, 23, 22, 23,
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
  { key: "studio", accent: "#4f6f9f", fill_opacity: 0.055 },
  { key: "grove", accent: "#557b70", fill_opacity: 0.045 },
  { key: "works", accent: "#9a6b5d", fill_opacity: 0.05 },
  { key: "commons", accent: "#716a9f", fill_opacity: 0.04 },
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

const macro_city_radius = 4;
const macro_city_diameter = macro_city_radius * 2 + 1;

const macro_city_coordinates = Array.from({ length: macro_city_diameter }, (_, q_index) => {
  const q = q_index - macro_city_radius;

  return Array.from({ length: macro_city_diameter }, (_, row_index) => ({
    q,
    row: row_index - macro_city_radius,
  }));
}).flat().filter((coordinate) =>
  get_hex_distance(coordinate.q, coordinate.row, 0, 0) <= macro_city_radius,
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

/** 61 个错位 City 中心让扩展后的大陆保持紧凑、狭长与开放等不同轮廓。 */
export const home_product_world_city_seeds = macro_city_coordinates.map((coordinate, index) => {
  const offset = city_offsets[index % city_offsets.length];
  const archetype = city_archetypes[index % city_archetypes.length];
  const distance_from_origin = get_hex_distance(coordinate.q, coordinate.row, 0, 0);
  const population_phase = Math.abs(coordinate.q * 11 + coordinate.row * 17 + index * 5);
  const agent_count = index === 0
    ? 3
    : index % 7 === 0
      ? 3
      : index % 3 === 0
        ? 2
        : distance_from_origin >= macro_city_radius && population_phase % 3 !== 0
          ? 0
          : 1;

  return {
    key: index === 0 ? "origin" : `city_${index}`,
    federation: get_federation_key(coordinate.q, coordinate.row),
    q: coordinate.q * city_spacing + offset.q,
    row: coordinate.row * city_spacing + offset.row,
    city_type: archetype.key,
    accent: archetype.accent,
    agent_count,
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

const assigned_cell_by_key = new Map(assigned_cells.map((cell) => [cell.key, cell]));

const lake_definitions = [
  { key: "memory_lake", q: -7, row: 5, radius: 2 },
  { key: "mirror_lake", q: 9, row: -8, radius: 2 },
] as const;

const wilderness_definitions = [
  { key: "quiet_wilds", q: 9, row: 5, radius: 2 },
] as const;

/** 找到覆盖当前坐标的命名湖泊。 */
function get_lake_key(q: number, row: number): HomeProductWorldFeatureKey | null {
  return lake_definitions.find((lake) =>
    get_hex_distance(q, row, lake.q, lake.row) <= lake.radius,
  )?.key ?? null;
}

/** 找到覆盖当前坐标的命名中立荒地。 */
function get_wilderness_key(q: number, row: number): HomeProductWorldFeatureKey | null {
  return wilderness_definitions.find((wilderness) =>
    get_hex_distance(q, row, wilderness.q, wilderness.row) <= wilderness.radius,
  )?.key ?? null;
}

/** 判断地块是否位于两个 Federation 的接壤带。 */
function is_federation_separator(cell: (typeof assigned_cells)[number]) {
  return hex_directions.some((direction) => {
    const neighbor = assigned_cell_by_key.get(`${cell.q + direction.q}:${cell.row + direction.row}`);
    return neighbor && neighbor.city_seed.federation !== cell.city_seed.federation;
  });
}

/** 将相邻 Federation 的竞争边界转换为水域或中立地带。 */
function get_geography(cell: (typeof assigned_cells)[number]): {
  terrain: HomeProductWorldTerrainKind;
  feature_key: HomeProductWorldFeatureKey | null;
} {
  if (cell.q === 0 && cell.row === 0) return { terrain: "land", feature_key: null };

  const lake_key = get_lake_key(cell.q, cell.row);
  if (lake_key) return { terrain: "water", feature_key: lake_key };

  const wilderness_key = get_wilderness_key(cell.q, cell.row);
  if (wilderness_key) return { terrain: "wilderness", feature_key: wilderness_key };

  if (is_federation_separator(cell)) {
    const is_named_strait = get_hex_distance(cell.q, cell.row, 2, -2) <= 5;
    return {
      terrain: "water",
      feature_key: is_named_strait ? "model_strait" : null,
    };
  }

  return { terrain: "land", feature_key: null };
}

const geographic_cells = assigned_cells.map((cell) => ({
  ...cell,
  ...get_geography(cell),
}));

const agent_cell_keys = new Set(home_product_world_city_seeds.flatMap((city_seed) =>
  geographic_cells
    .filter((cell) => cell.terrain === "land" && cell.city_seed.key === city_seed.key)
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
function get_cell_content(cell: (typeof geographic_cells)[number], index: number) {
  const residue = Math.abs(cell.q * 17 + cell.row * 31 + index * 7);

  if (cell.terrain === "water") return residue % 6 === 0 ? "water" : "empty";
  if (cell.terrain === "wilderness") return residue % 3 === 0 ? "forest" : "empty";
  if (agent_cell_keys.has(cell.key)) return "agent";

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
export const home_product_world_cells: HomeProductWorldCell[] = geographic_cells.map((cell, index) => {
  const distance = get_hex_distance(cell.q, cell.row, 0, 0);
  const growth_band_width = continent_radius / 4;
  const is_land = cell.terrain === "land";

  return {
    key: cell.key,
    q: cell.q,
    row: cell.row,
    city_key: is_land ? cell.city_seed.key : null,
    city_type: is_land ? cell.city_seed.city_type : null,
    federation: is_land ? cell.city_seed.federation : null,
    accent: cell.terrain === "water"
      ? "#7798a8"
      : cell.terrain === "wilderness"
        ? "#7f806d"
        : cell.city_seed.accent,
    fill_opacity: cell.terrain === "water"
      ? 0.11
      : cell.terrain === "wilderness"
        ? 0.035
        : cell.city_seed.fill_opacity,
    growth_stage: distance === 0 ? 0 : Math.min(4, Math.ceil(distance / growth_band_width)),
    content: get_cell_content(cell, index),
    terrain: cell.terrain,
    feature_key: cell.feature_key,
  };
});

/** 地图缩小后仍保持可读的 Federation、City 与地理标注。 */
export const home_product_world_annotations: HomeProductWorldAnnotation[] = [
  { key: "atlas", q: 0, row: 2, kind: "federation", label_key: "federations.atlas" },
  { key: "harbor", q: -11, row: 10, kind: "federation", label_key: "federations.harbor" },
  { key: "summit", q: -8, row: -6, kind: "federation", label_key: "federations.summit" },
  { key: "meridian", q: 11, row: -6, kind: "federation", label_key: "federations.meridian" },
  { key: "memory_lake", q: -7, row: 5, kind: "feature", label_key: "annotations.memory_lake" },
  { key: "mirror_lake", q: 9, row: -8, kind: "feature", label_key: "annotations.mirror_lake" },
  { key: "model_strait", q: 2, row: -2, kind: "feature", label_key: "annotations.model_strait" },
  { key: "quiet_wilds", q: 9, row: 5, kind: "feature", label_key: "annotations.quiet_wilds" },
  { key: "origin_city", q: 0, row: 0, kind: "city", label_key: "annotations.origin_city" },
  { key: "workshop_district", q: -5, row: -1, kind: "city", label_key: "annotations.workshop_district" },
];

const named_location_cell_keys = home_product_world_annotations
  .filter((annotation) => annotation.kind === "feature")
  .map((annotation) => `${annotation.q}:${annotation.row}`);

const core_city_cell_keys = home_product_world_city_seeds.flatMap((city_seed, index) => {
  if (index !== 0 && index % 7 !== 0) return [];

  const representative_cell = home_product_world_cells
    .filter((cell) => cell.city_key === city_seed.key && cell.content === "agent")
    .sort((cell_a, cell_b) =>
      get_hex_distance(cell_a.q, cell_a.row, city_seed.q, city_seed.row)
      - get_hex_distance(cell_b.q, cell_b.row, city_seed.q, city_seed.row),
    )[0];

  return representative_cell ? [representative_cell.key] : [];
});

/** 只有命名地貌和少量核心 City 可以打开地点信息卡。 */
export const home_product_world_interactive_cell_keys = new Set([
  ...named_location_cell_keys,
  ...core_city_cell_keys,
]);

/** 大陆从主角脚下的单个中心地块向外扩散为五层连续地块。 */
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
    if (cell.terrain !== "land") return [];
    const neighbor = cell_by_key.get(`${cell.q + direction.q}:${cell.row + direction.row}`);

    if (neighbor?.terrain === "land" && neighbor.city_key === cell.city_key) return [];
    if (neighbor?.terrain === "land" && cell.key > neighbor.key) return [];

    return [get_hex_edge_path(cell.q, cell.row, side)];
  }),
);

/** Federation 的闭合粗边界直接使用归属发生变化的蜂巢边缘。 */
export const home_product_world_federation_edges = home_product_world_cells.flatMap((cell) =>
  hex_directions.flatMap((direction, side) => {
    if (cell.terrain !== "land") return [];
    const neighbor = cell_by_key.get(`${cell.q + direction.q}:${cell.row + direction.row}`);

    if (neighbor?.terrain === "land" && neighbor.federation === cell.federation) return [];
    if (neighbor?.terrain === "land" && cell.key > neighbor.key) return [];

    return [get_hex_edge_path(cell.q, cell.row, side)];
  }),
);

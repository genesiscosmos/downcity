/**
 * 首页世界观图形使用的基础几何计算。
 *
 * Hero 与 Product World 共用同一套六边形网格和 Agent 轮廓，确保 City 地块、
 * Agent 居民在不同区块中保持一致的视觉语义。
 */

/** 生成平顶六边形地块路径。 */
export function home_world_hex_path(center_x: number, center_y: number, radius: number) {
  const height = radius * 0.866;

  return [
    `M${center_x - radius} ${center_y}`,
    `L${center_x - radius / 2} ${center_y - height}`,
    `L${center_x + radius / 2} ${center_y - height}`,
    `L${center_x + radius} ${center_y}`,
    `L${center_x + radius / 2} ${center_y + height}`,
    `L${center_x - radius / 2} ${center_y + height}`,
    "Z",
  ].join(" ");
}

/** 根据 flat-top axial 坐标计算六边形中心点。 */
export function home_world_hex_center(
  origin_x: number,
  origin_y: number,
  radius: number,
  q: number,
  row: number,
) {
  return {
    x: origin_x + radius * 1.5 * q,
    y: origin_y + radius * Math.sqrt(3) * (row + q / 2),
  };
}

/** 生成 Hero 同款 Agent 居民轮廓。 */
export function home_world_agent_path(center_x: number, center_y: number, size: number) {
  const half_width = size * 0.42;
  const body_top = center_y - size * 0.52;
  const body_bottom = center_y + size * 0.58;
  const shoulder_y = center_y - size * 0.18;
  const tail_step = size * 0.22;

  return [
    `M${center_x - half_width} ${body_bottom}`,
    `V${shoulder_y}`,
    `C${center_x - half_width} ${body_top + size * 0.16} ${center_x - size * 0.22} ${body_top} ${center_x} ${body_top}`,
    `C${center_x + size * 0.22} ${body_top} ${center_x + half_width} ${body_top + size * 0.16} ${center_x + half_width} ${shoulder_y}`,
    `V${body_bottom}`,
    `L${center_x + tail_step} ${body_bottom - tail_step * 0.72}`,
    `L${center_x} ${body_bottom}`,
    `L${center_x - tail_step} ${body_bottom - tail_step * 0.72}`,
    "Z",
  ].join(" ");
}

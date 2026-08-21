/**
 * Downcity Ghost 随机头像生成器。
 *
 * 头像只保留品牌 Ghost 主体，不添加背景或配件。随机性来自主体自身的低饱和
 * 深色纯色和同色系渐变填充；Ghost 路径、比例和眼睛位置来自品牌 SVG。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const body_palettes = [
  ["#536B78", "#8FA6B0"],
  ["#665B78", "#9F91B2"],
  ["#4F756E", "#8EAAA1"],
  ["#895E63", "#B98780"],
  ["#68717F", "#A7AFBC"],
  ["#806A4D", "#B59A74"],
] as const;

function hash_seed(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 读取开发或打包环境中的 Downcity 品牌矢量源文件。 */
export function read_downcity_logo_svg(): string {
  const module_directory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.resourcesPath, "downcity-logo.svg"),
    path.resolve(module_directory, "../../resources/downcity-logo.svg"),
    path.resolve(module_directory, "../../../resources/downcity-logo.svg"),
    path.resolve(process.cwd(), "app/desktop/resources/downcity-logo.svg"),
  ];
  const source_path = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source_path) throw new Error("Downcity Logo SVG asset is unavailable");
  return fs.readFileSync(source_path, "utf8");
}

/** 从品牌 SVG 中提取包含 Ghost 主体和双眼的原始分组。 */
function extract_ghost_group(logo_svg: string): string {
  const start = logo_svg.indexOf("<g transform=");
  const end = logo_svg.lastIndexOf("</g>");
  if (start < 0 || end < start) throw new Error("Downcity Logo SVG does not contain the Ghost group");
  return logo_svg.slice(start, end + 4);
}

function render_body_fill(variant: number, first_color: string, second_color: string): { definition: string; fill: string } {
  if (variant === 0) return { definition: "", fill: first_color };
  if (variant === 1) return {
    definition: `<linearGradient id="ghost-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${second_color}"/><stop offset="0.48" stop-color="${first_color}"/><stop offset="1" stop-color="${first_color}"/></linearGradient>`,
    fill: "url(#ghost-gradient)",
  };
  return {
    definition: `<linearGradient id="ghost-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${first_color}"/><stop offset="0.38" stop-color="${first_color}"/><stop offset="0.5" stop-color="${second_color}" stop-opacity=".55"/><stop offset="0.62" stop-color="${first_color}"/><stop offset="1" stop-color="${first_color}"/></linearGradient>`,
    fill: "url(#ghost-sheen)",
  };
}

/** 基于品牌 Ghost 生成一份透明背景的深色随机头像。 */
export function generate_agent_avatar_svg(seed: string, logo_svg: string): string {
  const hash = hash_seed(seed);
  const [first_color, second_color] = body_palettes[hash % body_palettes.length];
  const { definition, fill } = render_body_fill((hash >>> 4) % 4, first_color, second_color);
  const ghost_group = extract_ghost_group(logo_svg)
    .replace("#F7F6F0", fill)
    .replace("#1B1B18", "#F7F6F0");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="52 50 156 156" role="img" aria-labelledby="title desc"><title id="title">Downcity Ghost avatar</title><desc id="desc">A generated Downcity Ghost.</desc><defs>${definition}</defs>${ghost_group}</svg>`;
}

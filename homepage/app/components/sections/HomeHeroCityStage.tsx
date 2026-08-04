/**
 * 首页统一舞台中的 2D City 正立面绘图层。
 *
 * 该模块只负责 SVG 内容，不拥有 Section、滚动监听或独立坐标系。建筑采用纯正面
 * 轮廓，通过低饱和色块、窗光、植物与街道设施形成一座有居民的 Agent 城市。
 */

import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router";
import { HomeGhostGlyph } from "@/components/shared/HomeGhostGlyph";
import type { InterfaceLocale } from "@/types/interface-locale";
import type { HomeHeroCityStageProps } from "@/types/home/HomeGhost";

/** 唯一主角 Agent 在统一 1200×720 坐标系中的城市起点。 */
export const home_hero_agent_position = { x: 238, y: 633 } as const;

/** 将道路基线从 646 下移到 720，使 City 立面贴住共享 SVG 舞台底部。 */
export const home_hero_city_floor_offset = 74;

const facade_buildings = [
  { key: "west_home", x: -82, width: 146, top_y: 574, accent: "#557b70", kind: "house", rows: 1, columns: 3 },
  { key: "west_greenhouse", x: 78, width: 66, top_y: 592, accent: "#557b70", kind: "greenhouse", rows: 1, columns: 2 },
  { key: "studio", x: 194, width: 86, top_y: 520, accent: "#4f6f9f", kind: "studio", rows: 3, columns: 2 },
  { key: "studio_annex", x: 292, width: 58, top_y: 578, accent: "#716a9f", kind: "workshop", rows: 1, columns: 2 },
  { key: "landmark", x: 432, width: 74, top_y: 462, accent: "#4f6f9f", kind: "tower", rows: 4, columns: 2 },
  { key: "garden_house", x: 520, width: 60, top_y: 576, accent: "#557b70", kind: "garden", rows: 1, columns: 2 },
  { key: "plaza_pavilion", x: 706, width: 62, top_y: 586, accent: "#9a6b5d", kind: "house", rows: 1, columns: 2 },
  { key: "greenhouse", x: 780, width: 66, top_y: 590, accent: "#557b70", kind: "greenhouse", rows: 1, columns: 2 },
  { key: "workshop", x: 858, width: 96, top_y: 548, accent: "#b45d4c", kind: "workshop", rows: 2, columns: 3 },
  { key: "east_studio", x: 1010, width: 76, top_y: 526, accent: "#716a9f", kind: "studio", rows: 3, columns: 2 },
  { key: "east_home", x: 1122, width: 160, top_y: 572, accent: "#557b70", kind: "house", rows: 1, columns: 3 },
] as const;

const ambient_agents = [
  { key: "a01", x: 70, y: 633 },
  { key: "a02", x: 132, y: 633 },
  { key: "a03", x: 316, y: 633 },
  { key: "a04", x: 404, y: 633 },
  { key: "a05", x: 468, y: 633 },
  { key: "a06", x: 566, y: 633 },
  { key: "a07", x: 642, y: 633 },
  { key: "a08", x: 716, y: 633 },
  { key: "a09", x: 804, y: 633 },
  { key: "a10", x: 866, y: 633 },
  { key: "a11", x: 934, y: 633 },
  { key: "a12", x: 1052, y: 633 },
  { key: "a13", x: 1118, y: 633 },
  { key: "a14", x: 1180, y: 633 },
] as const;

const city_agent_size = 22;
const secondary_agent_accent = "var(--color-text-subtle)";
const agent_tag_background = "#e2b9af";
const environment_tag_background = "#e6c596";
const facade_tag_foreground = "#422e39";

/** 按建筑位置映射到真实产品与 Service Plugin 文档入口。 */
const facade_tags = [
  { key: "agent_harness", label: "AGENT HARNESS", x: 150, y: 430, width: 132, kind: "agent", path: "agent-sdk-docs" },
  { key: "cli", label: "CLI", x: 300, y: 430, width: 54, kind: "agent", path: "city-sdk-docs/packages/cli" },
  { key: "city", label: "CITY", x: 439, y: 430, width: 60, kind: "environment", path: "city-sdk-docs" },
  { key: "memory", label: "MEMORY", x: 512, y: 430, width: 76, kind: "environment", path: "plugins-docs/builtins/memory" },
  { key: "task", label: "TASK", x: 709, y: 430, width: 56, kind: "environment", path: "plugins-docs/builtins/task" },
  { key: "skill", label: "SKILL", x: 784, y: 430, width: 58, kind: "environment", path: "plugins-docs/builtins/skill" },
  { key: "shell", label: "SHELL", x: 873, y: 430, width: 66, kind: "environment", path: "plugins-docs/builtins/shell" },
  { key: "chat", label: "CHAT", x: 1019, y: 430, width: 58, kind: "environment", path: "plugins-docs/builtins/chat" },
] as const;

/** 绘制贴合单栋建筑位置、可键盘访问的产品链接。 */
function render_facade_tag(tag: (typeof facade_tags)[number], locale: InterfaceLocale) {
  const background = tag.kind === "agent" ? agent_tag_background : environment_tag_background;
  return (
    <Link key={tag.key} to={`/${locale}/${tag.path}`} className="group outline-none">
      <g transform={`translate(${tag.x} ${tag.y})`} className="cursor-pointer opacity-90 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        <title>{tag.label}</title>
        <rect width={tag.width} height="18" rx="9" fill={background} />
        <rect width={tag.width} height="18" rx="9" fill="none" stroke={facade_tag_foreground} strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="opacity-0 transition-opacity duration-150 group-focus-visible:opacity-100" />
        <text x={(tag.width - 14) / 2} y="12" textAnchor="middle" fill={facade_tag_foreground} className="pointer-events-none text-[7px] font-semibold" style={{ letterSpacing: "0.06em" }}>
          {tag.label}
        </text>
        <g transform={`translate(${tag.width - 12} 9)`} className="pointer-events-none">
          <path
            d="M0 0 H6 M3 -3 L6 0 L3 3"
            fill="none"
            stroke={facade_tag_foreground}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="-translate-x-0.5 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:translate-x-0 motion-reduce:transition-none"
          />
        </g>
      </g>
    </Link>
  );
}

/** 为背景居民生成错开的缓慢活动轨迹，避免整齐同步。 */
function get_ambient_agent_motion(agent_index: number) {
  const direction = agent_index % 2 === 0 ? 1 : -1;
  const distance = 7 + (agent_index % 3) * 3;
  return {
    x: [0, direction * distance, direction * distance, direction * -4, 0],
    duration: 9.5 + (agent_index % 4) * 1.4,
    delay: agent_index * -0.72,
  };
}

/** 生成不同建筑类型的正面屋顶轮廓。 */
function get_building_path(building: (typeof facade_buildings)[number]) {
  const right_x = building.x + building.width;
  if (building.kind === "house") {
    return `M${building.x} 646 V${building.top_y + 34} L${building.x + building.width / 2} ${building.top_y} L${right_x} ${building.top_y + 34} V646 Z`;
  }
  if (building.kind === "greenhouse") {
    return `M${building.x} 646 V${building.top_y + 28} Q${building.x + building.width / 2} ${building.top_y - 12} ${right_x} ${building.top_y + 28} V646 Z`;
  }
  if (building.kind === "studio") {
    return `M${building.x} 646 V${building.top_y + 18} H${building.x + building.width * 0.58} V${building.top_y} H${right_x} V646 Z`;
  }
  return `M${building.x} 646 V${building.top_y} H${right_x} V646 Z`;
}

/** 绘制单栋建筑的色块、窗格、入口与屋顶细节。 */
function render_building(building: (typeof facade_buildings)[number]) {
  const content_top = building.top_y + (building.kind === "house" ? 38 : 24);
  const row_gap = (604 - content_top) / Math.max(1, building.rows - 1);
  const column_gap = building.width / (building.columns + 1);

  return (
    <g key={building.key}>
      <path d={get_building_path(building)} fill={building.accent} fillOpacity="0.045" stroke={building.accent} strokeOpacity="0.38" strokeWidth="1.1" />
      <rect x={building.x + 4} y={Math.max(content_top - 10, building.top_y + 5)} width={building.width - 8} height="6" rx="2" fill={building.accent} fillOpacity="0.07" />
      {Array.from({ length: building.rows }, (_, row_index) => (
        <g key={`${building.key}-row-${row_index}`}>
          {Array.from({ length: building.columns }, (__, column_index) => (
            <rect
              key={`${building.key}-window-${column_index}`}
              x={building.x + column_gap * (column_index + 1) - 6}
              y={content_top + row_gap * row_index - 5}
              width="12"
              height={building.kind === "workshop" ? 11 : 10}
              rx="2"
              fill={building.accent}
              fillOpacity={(row_index + column_index) % 3 === 0 ? 0.2 : 0.07}
              stroke={building.accent}
              strokeOpacity="0.32"
            />
          ))}
        </g>
      ))}
      <path d={`M${building.x + building.width / 2 - 11} 646 V620 Q${building.x + building.width / 2} 608 ${building.x + building.width / 2 + 11} 620 V646`} fill={building.accent} fillOpacity="0.08" stroke={building.accent} strokeOpacity="0.34" />
      {building.kind === "garden" ? (
        <g fill="#557b70" fillOpacity="0.2" stroke="#557b70" strokeOpacity="0.42">
          <circle cx={building.x + 14} cy={building.top_y - 5} r="9" />
          <circle cx={building.x + 31} cy={building.top_y - 7} r="12" />
          <circle cx={building.x + 48} cy={building.top_y - 4} r="8" />
        </g>
      ) : null}
    </g>
  );
}

/** 绘制街道中的树木、灌木、路灯和长椅。 */
function render_street_detail(x: number, variant: number) {
  if (variant % 3 === 0) {
    return <g key={x}><path d={`M${x} 622 V649`} stroke="#557b70" strokeOpacity="0.42" /><circle cx={x} cy="610" r="14" fill="#557b70" fillOpacity="0.1" stroke="#557b70" strokeOpacity="0.36" /><circle cx={x - 9} cy="616" r="9" fill="#557b70" fillOpacity="0.07" /></g>;
  }
  if (variant % 3 === 1) {
    return <g key={x} fill="none" stroke="currentColor" strokeOpacity="0.24"><path d={`M${x} 596 V647 M${x} 596 Q${x + 20} 600 ${x + 18} 617`} /><circle cx={x + 18} cy="620" r="4" fill="currentColor" fillOpacity="0.18" /></g>;
  }
  return <g key={x} fill="none" stroke="currentColor" strokeOpacity="0.25"><path d={`M${x - 18} 632 H${x + 18} V640 H${x - 18} Z M${x - 13} 640 V648 M${x + 13} 640 V648`} /></g>;
}

/** 渲染与产品世界共享坐标系的城市正立面。 */
export function HomeHeroCityStage({ locale, city_opacity, city_y, city_scale }: HomeHeroCityStageProps) {
  const reduce_motion = useReducedMotion();

  return (
    <motion.g style={{ opacity: city_opacity, y: city_y, scale: city_scale, transformOrigin: "600px 720px", willChange: "transform, opacity" }}>
      <g transform={`translate(0 ${home_hero_city_floor_offset})`}>
        <g aria-hidden="true" className="pointer-events-none">
          {facade_buildings.map(render_building)}
          <path d="M-180 645.5 H1380" className="stroke-line-strong" strokeWidth="1.2" />
          <path d="M280 574 H322 V584 H280 M954 578 H1010 V588 H954" fill="var(--color-background)" className="stroke-line" />
          <g className="fill-none stroke-line-strong" strokeOpacity="0.55">
            <path d="M596 646 V608 H688 V646" />
            <path d="M612 608 Q642 586 672 608" />
            <path d="M620 629 H664 M628 629 V638 M656 629 V638" />
          </g>
          <g fill="#557b70" fillOpacity="0.08" stroke="#557b70" strokeOpacity="0.28">
            <circle cx="376" cy="631" r="12" /><circle cx="394" cy="634" r="9" />
            <circle cx="972" cy="633" r="11" /><circle cx="990" cy="636" r="8" />
          </g>
          {[34, 166, 372, 548, 684, 752, 974, 1102, 1192].map(render_street_detail)}
          <g fill="#557b70" fillOpacity="0.12" stroke="#557b70" strokeOpacity="0.3">
            {[188, 206, 1016, 1040].map((x) => <circle key={x} cx={x} cy="638" r={x % 2 === 0 ? 10 : 7} />)}
          </g>
        </g>

        <g role="group" aria-label={locale === "zh" ? "Downcity 产品文档" : "Downcity product documentation"}>
          {facade_tags.map((tag) => render_facade_tag(tag, locale))}
        </g>

        <g aria-hidden="true" className="pointer-events-none">
          {ambient_agents.map((agent, agent_index) => {
            const agent_motion = get_ambient_agent_motion(agent_index);
            return (
              <motion.g
                key={agent.key}
                opacity="0.48"
                animate={reduce_motion ? undefined : { x: agent_motion.x }}
                transition={reduce_motion ? undefined : { duration: agent_motion.duration, delay: agent_motion.delay, ease: "easeInOut", repeat: Infinity }}
              >
                <HomeGhostGlyph center_x={agent.x} center_y={agent.y} size={city_agent_size} accent={secondary_agent_accent} />
              </motion.g>
            );
          })}
        </g>

      </g>
    </motion.g>
  );
}

export default HomeHeroCityStage;

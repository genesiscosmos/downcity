/**
 * 首页统一舞台中的 2D City 正立面绘图层。
 *
 * 该模块只负责 SVG 内容，不拥有 Section、滚动监听或独立坐标系。建筑采用纯正面
 * 轮廓，通过低饱和色块、窗光、植物与街道设施形成一座有居民的 Agent 城市。
 */

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { Link } from "react-router";
import { HomeGhostGlyph } from "@/components/shared/HomeGhostGlyph";
import type { HomeHeroCityStageProps } from "@/types/home/HomeGhost";

/** 唯一主角 Agent 在统一 1200×720 坐标系中的城市起点。 */
export const home_hero_agent_position = { x: 238, y: 633 } as const;

/** 将道路基线从 646 下移到 720，使 City 立面贴住共享 SVG 舞台底部。 */
export const home_hero_city_floor_offset = 74;

const facade_buildings = [
  { key: "west_home", x: 0, width: 82, top_y: 574, accent: "#557b70", kind: "house", rows: 1, columns: 2 },
  { key: "west_greenhouse", x: 94, width: 66, top_y: 592, accent: "#557b70", kind: "greenhouse", rows: 1, columns: 2 },
  { key: "studio", x: 194, width: 86, top_y: 520, accent: "#4f6f9f", kind: "studio", rows: 3, columns: 2 },
  { key: "studio_annex", x: 292, width: 58, top_y: 578, accent: "#716a9f", kind: "workshop", rows: 1, columns: 2 },
  { key: "landmark", x: 432, width: 74, top_y: 462, accent: "#4f6f9f", kind: "tower", rows: 4, columns: 2 },
  { key: "garden_house", x: 520, width: 60, top_y: 576, accent: "#557b70", kind: "garden", rows: 1, columns: 2 },
  { key: "plaza_pavilion", x: 706, width: 62, top_y: 586, accent: "#9a6b5d", kind: "house", rows: 1, columns: 2 },
  { key: "greenhouse", x: 780, width: 66, top_y: 590, accent: "#557b70", kind: "greenhouse", rows: 1, columns: 2 },
  { key: "workshop", x: 858, width: 96, top_y: 548, accent: "#b45d4c", kind: "workshop", rows: 2, columns: 3 },
  { key: "east_studio", x: 1010, width: 76, top_y: 526, accent: "#716a9f", kind: "studio", rows: 3, columns: 2 },
  { key: "east_home", x: 1100, width: 100, top_y: 572, accent: "#557b70", kind: "house", rows: 1, columns: 2 },
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
const facade_tag_foreground = "var(--color-text)";

/** 按建筑位置映射到真实产品与 Service Plugin 文档入口。 */
const facade_tags = [
  { key: "federation", building_key: "west_home", label: "FEDERATION", y: 430, width: 92, path: "city-sdk-docs/reference/federation", description_zh: ["管理 Service 生命周期、鉴权", "HTTP 路由与运行时资源"], description_en: ["Runtime for services, auth", "HTTP routing and resources"] },
  { key: "services", building_key: "west_greenhouse", label: "SERVICES", y: 430, width: 78, path: "city-sdk-docs/packages/federation/service-and-action", description_zh: ["用 Service 与 Action 组织", "可复用的后端能力"], description_en: ["Reusable backend capabilities", "built with Service and Action"] },
  { key: "agent_harness", building_key: "studio", label: "AGENT HARNESS", y: 430, width: 132, path: "agent-sdk-docs", description_zh: ["运行 Agent 的核心框架", "组合模型、工具与会话"], description_en: ["Core runtime for agents", "Models, tools and sessions"] },
  { key: "cli", building_key: "studio_annex", label: "CLI", y: 430, width: 54, path: "city-sdk-docs/packages/cli", description_zh: ["从终端创建与管理", "Downcity 项目"], description_en: ["Create and manage", "Downcity from the terminal"] },
  { key: "city", building_key: "landmark", label: "CITY", y: 430, width: 60, path: "city-sdk-docs", description_zh: ["承载 Agent 与服务的", "产品运行环境"], description_en: ["Product environment for", "agents and services"] },
  { key: "memory", building_key: "garden_house", label: "MEMORY", y: 430, width: 76, path: "plugins-docs/builtins/memory", description_zh: ["保存与检索 Agent 的", "长期上下文"], description_en: ["Store and retrieve", "long-term agent context"] },
  { key: "task", building_key: "plaza_pavilion", label: "TASK", y: 430, width: 56, path: "plugins-docs/builtins/task", description_zh: ["组织可追踪、可执行的", "任务流程"], description_en: ["Organize trackable", "and executable tasks"] },
  { key: "skill", building_key: "greenhouse", label: "SKILL", y: 430, width: 58, path: "plugins-docs/builtins/skill", description_zh: ["为 Agent 装载可复用的", "专业能力"], description_en: ["Reusable capabilities", "for specialized agents"] },
  { key: "shell", building_key: "workshop", label: "SHELL", y: 430, width: 66, path: "plugins-docs/builtins/shell", description_zh: ["提供命令与进程的", "受控执行环境"], description_en: ["Controlled execution", "for commands and processes"] },
  { key: "ui_sdk", building_key: "east_studio", label: "UI SDK", y: 430, width: 70, path: "ui-sdk-docs", description_zh: ["构建 Console、Chat 与", "产品界面的 React 组件"], description_en: ["React components for", "console, chat and product UI"] },
  { key: "payments", building_key: "east_home", label: "PAYMENTS", y: 430, width: 82, path: "payments", description_zh: ["身份、Credits、支付与", "用量服务的完整基础设施"], description_en: ["Accounts, credits, payments", "and usage infrastructure"] },
] as const;

const facade_tag_by_building_key: ReadonlyMap<string, (typeof facade_tags)[number]> = new Map(
  facade_tags.map((tag) => [tag.building_key, tag] as const),
);

/** 绘制可预览、固定并在二次操作后进入文档的产品标注。 */
function render_facade_tag(
  tag: (typeof facade_tags)[number],
  building: (typeof facade_buildings)[number],
  locale: HomeHeroCityStageProps["locale"],
  is_selected: boolean,
  reduce_motion: boolean,
  on_select: () => void,
  on_select_key_down: (event: KeyboardEvent<SVGGElement>) => void,
) {
  const tag_height = 20;
  const selected_card_width = 164;
  const selected_card_height = 62;
  const building_center_x = building.x + building.width / 2;
  const tag_x = building_center_x - tag.width / 2;
  const selected_card_global_x = Math.min(
    Math.max(building_center_x - selected_card_width / 2, 8),
    1200 - selected_card_width - 8,
  );
  const selected_card_x = selected_card_global_x - tag_x;
  const selected_card_y = tag_height - selected_card_height;
  const content_center_x = is_selected ? selected_card_x + selected_card_width / 2 : tag.width / 2;
  const building_anchor_y = building.top_y - 6;
  const resting_tag_y = building.top_y - 27;
  const resting_tag_offset = Math.max(0, resting_tag_y - tag.y);
  const expanded_line_length = Math.max(1, building_anchor_y - tag.y - tag_height);
  const resting_line_length = Math.max(1, building_anchor_y - resting_tag_y - tag_height);
  const interaction_style = {
    "--facade-tag-resting-y": `${resting_tag_offset}px`,
    "--facade-line-resting-scale": resting_line_length / expanded_line_length,
  } as CSSProperties;
  const description_lines = locale === "zh" ? tag.description_zh : tag.description_en;
  const navigation_label = locale === "zh" ? "查看文档  →" : "View docs  →";
  const details_id = `facade-details-${tag.key}`;
  const transition = reduce_motion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" as const };
  const line_class_name = is_selected
    ? "pointer-events-none opacity-50 [transform-box:view-box] [transform:scaleY(1)]"
    : "pointer-events-none opacity-[0.12] [transform-box:view-box] [transform:scaleY(var(--facade-line-resting-scale))] transition-[transform,opacity] duration-200 ease-out group-hover/facade:opacity-50 group-hover/facade:[transform:scaleY(1)] group-focus-within/facade:opacity-50 group-focus-within/facade:[transform:scaleY(1)] motion-reduce:transition-none";
  const moving_tag_class_name = is_selected
    ? "[transform:translateY(0)]"
    : "[transform:translateY(var(--facade-tag-resting-y))] transition-transform duration-200 ease-out group-hover/facade:[transform:translateY(0)] group-focus-within/facade:[transform:translateY(0)] motion-reduce:transition-none";

  const tag_visual = (
    <g className={moving_tag_class_name}>
      <motion.rect
        initial={false}
        animate={{
          x: is_selected ? selected_card_x : 0,
          y: is_selected ? selected_card_y : 0,
          width: is_selected ? selected_card_width : tag.width,
          height: is_selected ? selected_card_height : tag_height,
          rx: is_selected ? 8 : 10,
        }}
        transition={transition}
        fill={building.accent}
        fillOpacity={is_selected ? 0.12 : 0.16}
        stroke={building.accent}
        strokeOpacity={is_selected ? 0.44 : 0.36}
        strokeWidth="0.8"
        vectorEffect="non-scaling-stroke"
        className={is_selected
          ? "opacity-100"
          : "opacity-0 transition-opacity duration-150 group-hover/facade:opacity-100 group-focus-within/facade:opacity-100 motion-reduce:transition-none"}
      />
      <g className={`${is_selected ? "-translate-y-10" : "translate-y-0"} transition-transform duration-200 ease-out motion-reduce:transition-none`}>
        <text
          x={content_center_x}
          y="13.2"
          textAnchor="middle"
          fill={facade_tag_foreground}
          className="pointer-events-none text-[7px] font-semibold"
          style={{ letterSpacing: "0.09em" }}
        >
          {tag.label}
        </text>
      </g>
      {is_selected ? (
        <motion.g
          id={details_id}
          initial={reduce_motion ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition}
          className="pointer-events-none"
        >
          <text x={content_center_x} y="-12" textAnchor="middle" fill={facade_tag_foreground} className="text-[7px] opacity-70">
            <tspan x={content_center_x}>{description_lines[0]}</tspan>
            <tspan x={content_center_x} dy="10">{description_lines[1]}</tspan>
          </text>
          <path d={`M${selected_card_x + 12} 3 H${selected_card_x + selected_card_width - 12}`} stroke={building.accent} strokeOpacity="0.22" strokeWidth="0.7" />
          <text x={content_center_x} y="14" textAnchor="middle" fill={building.accent} className="text-[7px] font-semibold">
            {navigation_label}
          </text>
        </motion.g>
      ) : null}
    </g>
  );

  return (
    <g style={interaction_style}>
      <title>{tag.label}</title>
      <g
        aria-hidden="true"
        style={{ transformOrigin: `${building_center_x}px ${building_anchor_y}px` }}
        className={line_class_name}
      >
        <path
          d={`M${building_center_x} ${tag.y + tag_height} L${building_center_x} ${building_anchor_y}`}
          fill="none"
          stroke={building.accent}
          strokeWidth="0.8"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={building_center_x} cy={building_anchor_y} r="1.7" fill={building.accent} />
      </g>
      <g transform={`translate(${tag_x} ${tag.y})`}>{tag_visual}</g>
      <g
        role="button"
        tabIndex={0}
        aria-expanded={is_selected}
        aria-controls={is_selected ? details_id : undefined}
        className="cursor-pointer outline-none"
        onClick={(event) => {
          event.stopPropagation();
          on_select();
        }}
        onKeyDown={on_select_key_down}
      >
        <rect x={tag_x} y={tag.y} width={tag.width} height={resting_tag_offset + tag_height} fill="transparent" />
      </g>
      {is_selected ? (
        <Link
          to={`/${locale}/${tag.path}`}
          aria-label={`${tag.label}: ${description_lines.join(" ")}. ${navigation_label}`}
          className="cursor-pointer outline-none"
          onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
        >
          <rect
            x={tag_x + selected_card_x}
            y={tag.y + selected_card_y}
            width={selected_card_width}
            height={selected_card_height}
            rx="8"
            fill="transparent"
          />
        </Link>
      ) : null}
    </g>
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
function render_building(
  building: (typeof facade_buildings)[number],
  is_interactive: boolean,
  is_selected = false,
) {
  const content_top = building.top_y + (building.kind === "house" ? 38 : 24);
  const row_gap = (604 - content_top) / Math.max(1, building.rows - 1);
  const column_gap = building.width / (building.columns + 1);

  return (
    <g data-facade-building={building.key}>
      <path
        d={get_building_path(building)}
        fill={building.accent}
        fillOpacity="0.045"
        stroke={building.accent}
        strokeOpacity="0.28"
        strokeWidth="1.1"
        className={is_interactive
          ? is_selected
            ? "[fill-opacity:0.075] [stroke-opacity:0.74]"
            : "transition-[stroke-opacity,fill-opacity] duration-150 group-hover/facade:[fill-opacity:0.075] group-hover/facade:[stroke-opacity:0.74] group-focus-within/facade:[fill-opacity:0.075] group-focus-within/facade:[stroke-opacity:0.74] motion-reduce:transition-none"
          : undefined}
      />
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
  const [selected_facade_key, set_selected_facade_key] = useState<string | null>(null);

  /** 选择新建筑，或再次操作当前建筑时将详情收起。 */
  const toggle_facade_selection = (facade_key: string) => {
    set_selected_facade_key((current_key) => current_key === facade_key ? null : facade_key);
  };

  /** 让 SVG 建筑通过键盘获得与指针一致的选择行为。 */
  const handle_facade_key_down = (event: KeyboardEvent<SVGGElement>, facade_key: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      toggle_facade_selection(facade_key);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      set_selected_facade_key(null);
    }
  };

  return (
    <motion.g style={{ opacity: city_opacity, y: city_y, scale: city_scale, transformOrigin: "600px 720px", willChange: "transform, opacity" }}>
      <g transform={`translate(0 ${home_hero_city_floor_offset})`}>
        <defs>
          <clipPath id="home-hero-city-floor-clip">
            <rect x="-180" y="0" width="1560" height="645.5" />
          </clipPath>
        </defs>
        <g clipPath="url(#home-hero-city-floor-clip)">
          <g role="group" aria-label={locale === "zh" ? "Downcity 产品文档" : "Downcity product documentation"}>
            {facade_buildings.map((building) => {
              const tag = facade_tag_by_building_key.get(building.key);
              if (!tag) {
                return (
                  <g key={building.key} aria-hidden="true" className="pointer-events-none">
                    {render_building(building, false)}
                  </g>
                );
              }

              const is_selected = selected_facade_key === tag.key;
              return (
                <g
                  key={building.key}
                  className="group/facade outline-none"
                  data-facade-tag={tag.key}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      set_selected_facade_key(null);
                    }
                  }}
                >
                  <g
                    role="button"
                    tabIndex={0}
                    aria-expanded={is_selected}
                    aria-controls={`facade-details-${tag.key}`}
                    aria-label={locale === "zh" ? `查看 ${tag.label} 简介` : `Preview ${tag.label}`}
                    className="cursor-pointer outline-none"
                    onClick={() => toggle_facade_selection(tag.key)}
                    onKeyDown={(event) => handle_facade_key_down(event, tag.key)}
                  >
                    {render_building(building, true, is_selected)}
                  </g>
                  {render_facade_tag(
                    tag,
                    building,
                    locale,
                    is_selected,
                    Boolean(reduce_motion),
                    () => toggle_facade_selection(tag.key),
                    (event) => handle_facade_key_down(event, tag.key),
                  )}
                </g>
              );
            })}
          </g>
          <g aria-hidden="true" className="pointer-events-none">
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
        <path d="M-180 645.5 H1380" aria-hidden="true" className="pointer-events-none stroke-line-strong" strokeWidth="1.2" />
      </g>
    </motion.g>
  );
}

export default HomeHeroCityStage;

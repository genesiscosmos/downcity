import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";

const city_cells = [
  { q: 0, row: 0, kind: "building" },
  { q: -1, row: 0, kind: "agent" },
  { q: 0, row: -1, kind: "agent" },
  { q: 1, row: -1, kind: "empty" },
  { q: 1, row: 0, kind: "agent" },
  { q: 0, row: 1, kind: "forest" },
  { q: -1, row: 1, kind: "empty" },
] as const;

const federation_services = [
  { key: "models", x: 424, y: 82, color: "#4f6f9f" },
  { key: "services", x: 478, y: 46, color: "#3f7d5b" },
  { key: "auth", x: 562, y: 46, color: "#b45d4c" },
  { key: "usage", x: 616, y: 82, color: "#c2a650" },
] as const;

/**
 * 生成与首页 Hero 一致的平顶六边形地块。
 */
function hex_path(center_x: number, center_y: number, radius: number) {
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

/**
 * 根据 flat-top axial 坐标计算六边形地块中心点。
 */
function hex_center(origin_x: number, origin_y: number, radius: number, q: number, row: number) {
  return {
    x: origin_x + radius * 1.5 * q,
    y: origin_y + radius * Math.sqrt(3) * (row + q / 2),
  };
}

/**
 * 首页产品交付与运行关系场景。
 *
 * 本图延续 Hero 的 City 世界观：Creator 构建由六边形地块组成的产品 City，
 * City 与其中的 Agent 运行在用户终端内，并向上连接 Federation 的共享能力。
 * 关系通过空间层级、柔和曲线和聚焦反馈表达，不使用传统流程图容器与箭头。
 */
export function HomeArchitectureDiagram() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const reduce_motion = useReducedMotion();
  const [focused_node, set_focused_node] = useState<string | null>(null);

  const relation_opacity = (node_keys: string[]) => {
    if (focused_node === null) {
      return 0.3;
    }

    return node_keys.includes(focused_node) ? 0.88 : 0.08;
  };

  const node_opacity = (node_key: string) => {
    if (focused_node === null || focused_node === node_key) {
      return 1;
    }

    return 0.28;
  };

  const focus_props = (node_key: string) => ({
    tabIndex: 0,
    onMouseEnter: () => set_focused_node(node_key),
    onMouseLeave: () => set_focused_node(null),
    onFocus: () => set_focused_node(node_key),
    onBlur: () => set_focused_node(null),
  });

  return (
    <section id="architecture" className="scroll-mt-16 border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="mb-12 max-w-3xl md:mb-16">
          <p className="mb-4 text-[0.78rem] font-medium uppercase text-text-soft">
            {t("architecture.sectionLabel")}
          </p>
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] text-foreground">
            {t("architecture.title")}
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-[1.65] text-text-soft">
            {t("architecture.description")}
          </p>
        </div>

        <figure className="border-y border-line py-8 md:py-12" aria-labelledby="home-architecture-caption">
          <svg viewBox="0 0 1040 480" className="hidden h-auto w-full md:block" role="img" aria-label={t("architecture.diagramLabel")}>
            <defs>
              <radialGradient id="city-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#3f7d5b" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#3f7d5b" stopOpacity="0" />
              </radialGradient>
            </defs>

            <motion.path
              d="M244 226 C315 162 368 130 449 111"
              className="fill-none stroke-line-strong"
              initial={false}
              animate={{ opacity: relation_opacity(["creator", "federation"]) }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
            />
            <motion.path
              d="M262 286 C326 286 356 294 405 302"
              className="fill-none stroke-[#3f7d5b]"
              initial={false}
              animate={{ opacity: relation_opacity(["creator", "city"]) }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
            />
            <motion.path
              d="M520 151 C520 185 520 211 520 238"
              className="fill-none stroke-[#4f6f9f]"
              initial={false}
              animate={{ opacity: relation_opacity(["federation", "city"]) }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
            />
            <motion.path
              d="M778 286 C724 286 689 296 636 305"
              className="fill-none stroke-line-strong"
              initial={false}
              animate={{ opacity: relation_opacity(["user", "city"]) }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
            />

            <motion.g
              role="group"
              aria-label={t("architecture.federationLabel")}
              className="cursor-default outline-none"
              initial={false}
              animate={{ opacity: node_opacity("federation") }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
              {...focus_props("federation")}
            >
              <path d="M424 82 C454 112 478 125 520 126 C562 125 586 112 616 82" className="fill-none stroke-line-strong opacity-50" />
              <path d="M478 46 C489 75 501 88 520 92 C539 88 551 75 562 46" className="fill-none stroke-line-strong opacity-40" />
              {federation_services.map((service) => (
                <g key={service.key}>
                  <circle cx={service.x} cy={service.y} r="7" fill={service.color} fillOpacity="0.16" stroke={service.color} />
                  <text x={service.x} y={service.y + 22} textAnchor="middle" className="fill-text-subtle text-[7px]">
                    {t(`architecture.services.${service.key}`)}
                  </text>
                </g>
              ))}
              <circle cx="500" cy="108" r="11" className="fill-background stroke-foreground" />
              <circle cx="520" cy="101" r="11" className="fill-background stroke-foreground" />
              <circle cx="540" cy="108" r="11" className="fill-background stroke-foreground" />
              <text x="520" y="139" textAnchor="middle" className="fill-foreground text-[14px] font-semibold">{t("architecture.federation")}</text>
              <text x="520" y="157" textAnchor="middle" className="fill-text-subtle text-[8px]">{t("architecture.federationCaption")}</text>
            </motion.g>

            <motion.g
              role="group"
              aria-label={t("architecture.creatorLabel")}
              className="cursor-default outline-none"
              initial={false}
              animate={{ opacity: node_opacity("creator") }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
              {...focus_props("creator")}
            >
              <path d={hex_path(167, 250, 29)} className="fill-[#3f7d5b]/[0.04] stroke-[#3f7d5b] opacity-70" />
              <path d={hex_path(211, 276, 29)} className="fill-none stroke-line-strong opacity-55" />
              <path d={hex_path(167, 301, 29)} className="fill-none stroke-line-strong opacity-38" />
              <circle cx="120" cy="252" r="17" className="fill-background stroke-foreground" />
              <circle cx="114" cy="249" r="1.4" className="fill-foreground" />
              <circle cx="126" cy="249" r="1.4" className="fill-foreground" />
              <path d="M115 258 Q120 262 125 258" className="fill-none stroke-foreground" />
              <path d="M103 286 C103 272 110 265 120 265 C130 265 137 272 137 286 V317 L129 311 L120 317 L111 311 L103 317 Z" className="fill-[#3f7d5b]" />
              <path d="M136 280 C149 274 156 267 164 256" className="fill-none stroke-foreground" strokeLinecap="round" />
              <text x="120" y="352" textAnchor="middle" className="fill-foreground text-[14px] font-semibold">{t("architecture.creator")}</text>
              <text x="120" y="371" textAnchor="middle" className="fill-text-subtle text-[8px]">{t("architecture.creatorCaption")}</text>
            </motion.g>

            <motion.g
              role="group"
              aria-label={t("architecture.userEnvironmentLabel")}
              className="cursor-default outline-none"
              initial={false}
              animate={{ opacity: node_opacity("city") }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
              {...focus_props("city")}
            >
              <ellipse cx="520" cy="305" rx="180" ry="118" fill="url(#city-glow)" />
              <path d="M354 241 V218 H686 V241 M354 362 V385 H686 V362" className="fill-none stroke-line-strong" strokeLinecap="round" />
              <path d="M393 410 H647 M476 385 V410 M564 385 V410" className="fill-none stroke-line-strong opacity-65" strokeLinecap="round" />
              <text x="520" y="434" textAnchor="middle" className="fill-text-soft text-[9px] font-medium">{t("architecture.userEnvironment")}</text>

              {city_cells.map((cell, cell_index) => {
                const cell_center = hex_center(520, 300, 42, cell.q, cell.row);
                const is_center = cell.q === 0 && cell.row === 0;

                return (
                  <motion.g
                    key={`${cell.q}-${cell.row}`}
                    initial={false}
                    animate={{ opacity: focused_node === null || focused_node === "city" ? 1 : 0.38 }}
                    transition={{ duration: reduce_motion ? 0 : 0.25, delay: reduce_motion ? 0 : cell_index * 0.015 }}
                  >
                    <path d={hex_path(cell_center.x, cell_center.y, 42)} fill={is_center ? "#3f7d5b0D" : "transparent"} className={is_center ? "stroke-[#3f7d5b]" : "stroke-line-strong"} />
                    {cell.kind === "building" && (
                      <g aria-hidden="true">
                        <path d={`M${cell_center.x - 17} ${cell_center.y + 16} V${cell_center.y - 10} H${cell_center.x + 2} V${cell_center.y + 16} M${cell_center.x + 2} ${cell_center.y + 16} V${cell_center.y - 3} H${cell_center.x + 17} V${cell_center.y + 16}`} className="fill-none stroke-foreground" strokeLinecap="round" strokeLinejoin="round" />
                        <path d={`M${cell_center.x - 11} ${cell_center.y - 3} H${cell_center.x - 6} M${cell_center.x - 11} ${cell_center.y + 5} H${cell_center.x - 6} M${cell_center.x + 8} ${cell_center.y + 5} H${cell_center.x + 12}`} className="stroke-foreground" strokeLinecap="round" />
                      </g>
                    )}
                    {cell.kind === "forest" && (
                      <g aria-hidden="true">
                        <path d={`M${cell_center.x - 12} ${cell_center.y + 12} L${cell_center.x - 3} ${cell_center.y - 11} L${cell_center.x + 6} ${cell_center.y + 12} Z M${cell_center.x + 2} ${cell_center.y + 12} L${cell_center.x + 12} ${cell_center.y - 14} L${cell_center.x + 21} ${cell_center.y + 12} Z`} className="fill-none stroke-foreground" strokeLinejoin="round" />
                      </g>
                    )}
                    {cell.kind === "agent" && (
                      <g aria-hidden="true">
                        <path d={`M${cell_center.x - 13} ${cell_center.y + 18} V${cell_center.y} C${cell_center.x - 13} ${cell_center.y - 10} ${cell_center.x - 7} ${cell_center.y - 16} ${cell_center.x} ${cell_center.y - 16} C${cell_center.x + 7} ${cell_center.y - 16} ${cell_center.x + 13} ${cell_center.y - 10} ${cell_center.x + 13} ${cell_center.y} V${cell_center.y + 18} L${cell_center.x + 7} ${cell_center.y + 13} L${cell_center.x} ${cell_center.y + 18} L${cell_center.x - 7} ${cell_center.y + 13} Z`} className="fill-[#4f6f9f]" />
                        <circle cx={cell_center.x - 4.5} cy={cell_center.y - 2.5} r="1.6" className="fill-background" />
                        <circle cx={cell_center.x + 4.5} cy={cell_center.y - 2.5} r="1.6" className="fill-background" />
                      </g>
                    )}
                  </motion.g>
                );
              })}
              <text x="365" y="200" className="fill-foreground text-[10px] font-semibold">{t("architecture.productCity")}</text>
              <text x="365" y="214" className="fill-text-subtle text-[7px]">{t("architecture.productBoundary")}</text>
            </motion.g>

            <motion.g
              role="group"
              aria-label={t("architecture.user")}
              className="cursor-default outline-none"
              initial={false}
              animate={{ opacity: node_opacity("user") }}
              transition={{ duration: reduce_motion ? 0 : 0.25 }}
              {...focus_props("user")}
            >
              <circle cx="842" cy="252" r="17" className="fill-background stroke-foreground" />
              <path d="M825 286 C825 272 832 265 842 265 C852 265 859 272 859 286 V317 L851 311 L842 317 L833 311 L825 317 Z" className="fill-[#b45d4c]" />
              <path d="M824 280 C811 275 803 270 793 261" className="fill-none stroke-foreground" strokeLinecap="round" />
              <path d={hex_path(891, 250, 29)} className="fill-none stroke-line-strong opacity-45" />
              <path d={hex_path(891, 301, 29)} className="fill-[#b45d4c]/[0.04] stroke-[#b45d4c] opacity-60" />
              <text x="842" y="352" textAnchor="middle" className="fill-foreground text-[14px] font-semibold">{t("architecture.user")}</text>
              <text x="842" y="371" textAnchor="middle" className="fill-text-subtle text-[8px]">{t("architecture.userControl")}</text>
            </motion.g>
          </svg>

          <svg viewBox="0 0 360 520" className="h-auto w-full md:hidden" role="img" aria-label={t("architecture.diagramLabel")}>
            <path d="M180 93 C180 132 180 162 180 192" className="fill-none stroke-[#4f6f9f] opacity-40" />
            <path d="M82 194 C107 164 126 146 151 127" className="fill-none stroke-line-strong opacity-30" />
            <path d="M93 315 C116 301 130 294 145 289" className="fill-none stroke-[#3f7d5b] opacity-38" />
            <path d="M267 315 C244 301 230 294 215 289" className="fill-none stroke-line-strong opacity-30" />

            <g aria-label={t("architecture.federationLabel")} role="img">
              <circle cx="166" cy="48" r="8" className="fill-background stroke-foreground" />
              <circle cx="180" cy="43" r="8" className="fill-background stroke-foreground" />
              <circle cx="194" cy="48" r="8" className="fill-background stroke-foreground" />
              <text x="180" y="74" textAnchor="middle" className="fill-foreground text-[10px] font-semibold">{t("architecture.federation")}</text>
              <text x="180" y="90" textAnchor="middle" className="fill-text-subtle text-[6px]">{t("architecture.services.models")} · {t("architecture.services.services")} · {t("architecture.services.auth")} · {t("architecture.services.usage")}</text>
            </g>

            <g aria-label={t("architecture.creatorLabel")} role="img">
              <circle cx="55" cy="245" r="12" className="fill-background stroke-foreground" />
              <path d="M43 269 C43 259 48 254 55 254 C62 254 67 259 67 269 V291 L61 287 L55 291 L49 287 L43 291 Z" className="fill-[#3f7d5b]" />
              <path d={hex_path(91, 249, 20)} className="fill-none stroke-[#3f7d5b] opacity-65" />
              <text x="55" y="315" textAnchor="middle" className="fill-foreground text-[9px] font-semibold">{t("architecture.creator")}</text>
            </g>

            <g aria-label={t("architecture.user")} role="img">
              <circle cx="305" cy="245" r="12" className="fill-background stroke-foreground" />
              <path d="M293 269 C293 259 298 254 305 254 C312 254 317 259 317 269 V291 L311 287 L305 291 L299 287 L293 291 Z" className="fill-[#b45d4c]" />
              <path d={hex_path(269, 249, 20)} className="fill-none stroke-[#b45d4c] opacity-58" />
              <text x="305" y="315" textAnchor="middle" className="fill-foreground text-[9px] font-semibold">{t("architecture.user")}</text>
            </g>

            <g aria-label={t("architecture.userEnvironmentLabel")} role="img">
              <path d="M116 194 V177 H244 V194 M116 385 V402 H244 V385" className="fill-none stroke-line-strong" strokeLinecap="round" />
              <path d="M145 426 H215 M166 402 V426 M194 402 V426" className="fill-none stroke-line-strong opacity-65" />
              {city_cells.map((cell) => {
                const cell_center = hex_center(180, 285, 28, cell.q, cell.row);
                return (
                  <g key={`${cell.q}-${cell.row}`}>
                    <path d={hex_path(cell_center.x, cell_center.y, 28)} fill={cell.kind === "building" ? "#3f7d5b0D" : "transparent"} className={cell.kind === "building" ? "stroke-[#3f7d5b]" : "stroke-line-strong"} />
                    {cell.kind === "building" && <path d={`M${cell_center.x - 10} ${cell_center.y + 11} V${cell_center.y - 7} H${cell_center.x + 1} V${cell_center.y + 11} M${cell_center.x + 1} ${cell_center.y + 11} V${cell_center.y - 2} H${cell_center.x + 10} V${cell_center.y + 11}`} className="fill-none stroke-foreground" />}
                    {cell.kind === "forest" && <path d={`M${cell_center.x - 8} ${cell_center.y + 8} L${cell_center.x} ${cell_center.y - 10} L${cell_center.x + 8} ${cell_center.y + 8} Z`} className="fill-none stroke-foreground" />}
                    {cell.kind === "agent" && (
                      <>
                        <path d={`M${cell_center.x - 8} ${cell_center.y + 11} V${cell_center.y} C${cell_center.x - 8} ${cell_center.y - 7} ${cell_center.x - 4} ${cell_center.y - 10} ${cell_center.x} ${cell_center.y - 10} C${cell_center.x + 4} ${cell_center.y - 10} ${cell_center.x + 8} ${cell_center.y - 7} ${cell_center.x + 8} ${cell_center.y} V${cell_center.y + 11} L${cell_center.x + 4} ${cell_center.y + 8} L${cell_center.x} ${cell_center.y + 11} L${cell_center.x - 4} ${cell_center.y + 8} Z`} className="fill-[#4f6f9f]" />
                        <circle cx={cell_center.x - 2.5} cy={cell_center.y - 1.5} r="1" className="fill-background" />
                        <circle cx={cell_center.x + 2.5} cy={cell_center.y - 1.5} r="1" className="fill-background" />
                      </>
                    )}
                  </g>
                );
              })}
              <text x="180" y="448" textAnchor="middle" className="fill-foreground text-[8px] font-semibold">{t("architecture.productCity")}</text>
              <text x="180" y="466" textAnchor="middle" className="fill-text-soft text-[7px]">{t("architecture.userEnvironment")}</text>
            </g>

            <text x="180" y="495" textAnchor="middle" className="fill-text-subtle text-[7px]">{t("architecture.mobileCaption")}</text>
          </svg>

          <figcaption id="home-architecture-caption" className="sr-only">{t("architecture.diagramLabel")}</figcaption>
        </figure>
      </div>
    </section>
  );
}

export default HomeArchitectureDiagram;

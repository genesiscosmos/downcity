import { useState } from "react";
import { useLocation } from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { resolve_interface_locale } from "@/lib/interface-locale";

const city_tiles = [
  {
    key: "build",
    accent: "#3f7d5b",
    connector: "M590 94 C510 125 418 118 270 148",
    origin: { x: 270, y: 235 },
    hit: { cx: 270, cy: 235, rx: 118, ry: 105 },
    label: { x: 183, y: 157 },
    cells: [
      { q: 0, row: 0, kind: "building" },
      { q: -1, row: 0, kind: "agent" },
      { q: 0, row: -1, kind: "forest" },
      { q: 1, row: -1, kind: "empty" },
      { q: 1, row: 0, kind: "agent" },
      { q: 0, row: 1, kind: "empty" },
      { q: -1, row: 1, kind: "agent" },
    ],
  },
  {
    key: "research",
    accent: "#4f6f9f",
    connector: "M610 94 C690 123 782 112 920 133",
    origin: { x: 920, y: 218 },
    hit: { cx: 920, cy: 218, rx: 118, ry: 105 },
    label: { x: 1000, y: 141 },
    cells: [
      { q: 0, row: 0, kind: "empty" },
      { q: -1, row: 0, kind: "agent" },
      { q: 0, row: -1, kind: "forest" },
      { q: 1, row: -1, kind: "building" },
      { q: 1, row: 0, kind: "agent" },
      { q: 0, row: 1, kind: "agent" },
      { q: -1, row: 1, kind: "empty" },
    ],
  },
  {
    key: "operations",
    accent: "#b45d4c",
    connector: "M600 97 C600 158 603 211 600 245",
    origin: { x: 600, y: 318 },
    hit: { cx: 600, cy: 318, rx: 118, ry: 70 },
    label: { x: 686, y: 266 },
    cells: [
      { q: 0, row: 0, kind: "building" },
      { q: -1, row: 0, kind: "agent" },
      { q: 0, row: -1, kind: "forest" },
      { q: 1, row: -1, kind: "empty" },
      { q: 1, row: 0, kind: "agent" },
      { q: -1, row: 1, kind: "agent" },
    ],
  },
] as const;

const mobile_city_tiles = [
  {
    key: "build",
    accent: "#3f7d5b",
    origin: { x: 76, y: 132 },
    label: { x: 32, y: 85 },
    cells: [
      { q: 0, row: 0, kind: "building" },
      { q: -1, row: 0, kind: "agent" },
      { q: 0, row: -1, kind: "empty" },
      { q: 1, row: -1, kind: "agent" },
    ],
  },
  {
    key: "research",
    accent: "#4f6f9f",
    origin: { x: 284, y: 132 },
    label: { x: 328, y: 85 },
    cells: [
      { q: 0, row: 0, kind: "empty" },
      { q: -1, row: 0, kind: "agent" },
      { q: 0, row: -1, kind: "forest" },
      { q: 1, row: -1, kind: "agent" },
    ],
  },
  {
    key: "operations",
    accent: "#b45d4c",
    origin: { x: 180, y: 238 },
    label: { x: 226, y: 191 },
    cells: [
      { q: 0, row: 0, kind: "building" },
      { q: -1, row: 0, kind: "agent" },
      { q: 0, row: -1, kind: "empty" },
      { q: 1, row: -1, kind: "agent" },
    ],
  },
] as const;

/**
 * 生成平顶六边形地块路径。
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
 * 根据 flat-top axial 坐标计算六边形中心点，确保相邻地块只共享完整边。
 */
function hex_center(origin_x: number, origin_y: number, radius: number, q: number, row: number) {
  return {
    x: origin_x + radius * 1.5 * q,
    y: origin_y + radius * Math.sqrt(3) * (row + q / 2),
  };
}

/**
 * 首页 Agent 六边形社区封面。
 *
 * 相邻地块自然形成 City，building、forest、空地与 ghost 居民共同建立社区语义。
 * Federation 只以弱连接组织多个地块群；悬停命中整个 City 后，所属地块和居民
 * 同步提亮，不产生循环动画或几何位移。
 */
export function HomeHeroCover() {
  const { i18n } = useTranslation("home");
  const location = useLocation();
  const locale = resolve_interface_locale(location.pathname, i18n.resolvedLanguage ?? i18n.language);
  const t = i18n.getFixedT(locale, "home");
  const reduce_motion = useReducedMotion();
  const [focused_city, set_focused_city] = useState<string | null>(null);

  return (
    <figure
      className="relative left-1/2 mt-6 w-screen -translate-x-1/2 overflow-hidden sm:mt-8"
      aria-labelledby="home-hero-cover-caption"
    >
      <div className="mx-auto max-w-[1320px] px-3 py-2 sm:px-8 sm:py-4">
        <svg viewBox="0 0 1200 390" className="hidden h-auto w-full sm:block">
          <g aria-label={t("hero.ecosystem.federationLabel")} role="img">
            <circle cx="580" cy="36" r="10" className="fill-background stroke-foreground" />
            <circle cx="600" cy="29" r="10" className="fill-background stroke-foreground" />
            <circle cx="620" cy="36" r="10" className="fill-background stroke-foreground" />
            <text x="600" y="70" textAnchor="middle" className="fill-foreground text-[14px] font-semibold">Federation</text>
            <text x="600" y="89" textAnchor="middle" className="fill-text-subtle text-[8px]">{t("hero.ecosystem.federationCaption")}</text>
          </g>

          {city_tiles.map((city_node) => {
            const is_focused = focused_city === city_node.key;
            const is_dimmed = focused_city !== null && !is_focused;

            return (
              <motion.g
                key={city_node.key}
                tabIndex={0}
                role="group"
                aria-label={t(`hero.ecosystem.cities.${city_node.key}.label`)}
                onMouseEnter={() => set_focused_city(city_node.key)}
                onMouseLeave={() => set_focused_city(null)}
                onFocus={() => set_focused_city(city_node.key)}
                onBlur={() => set_focused_city(null)}
                className="cursor-default outline-none"
              >
                <ellipse
                  cx={city_node.hit.cx}
                  cy={city_node.hit.cy}
                  rx={city_node.hit.rx}
                  ry={city_node.hit.ry}
                  fill="transparent"
                  pointerEvents="all"
                />
                <motion.path
                  d={city_node.connector}
                  fill="none"
                  stroke={is_focused ? city_node.accent : "currentColor"}
                  className="text-line-strong"
                  initial={false}
                  animate={{ opacity: is_dimmed ? 0.1 : is_focused ? 0.8 : 0.28 }}
                  transition={{ duration: reduce_motion ? 0 : 0.25 }}
                />
                <motion.text
                  x={city_node.label.x}
                  y={city_node.label.y}
                  className="fill-text-soft text-[9px] font-medium"
                  initial={false}
                  animate={{ opacity: is_dimmed ? 0.28 : is_focused ? 1 : 0.66 }}
                  transition={{ duration: reduce_motion ? 0 : 0.25 }}
                >
                  {t(`hero.ecosystem.cities.${city_node.key}.name`)}
                </motion.text>

                {city_node.cells.map((cell, cell_index) => {
                  const cell_center = hex_center(city_node.origin.x, city_node.origin.y, 32, cell.q, cell.row);

                  return (
                    <motion.g
                      key={`${cell.q}-${cell.row}`}
                      initial={false}
                      animate={{ opacity: is_dimmed ? 0.28 : is_focused ? 1 : 0.72 }}
                      transition={{ duration: reduce_motion ? 0 : 0.25, delay: reduce_motion ? 0 : cell_index * 0.015 }}
                    >
                      <path
                        d={hex_path(cell_center.x, cell_center.y, 32)}
                        fill={is_focused ? `${city_node.accent}0D` : "transparent"}
                        stroke={is_focused ? city_node.accent : "currentColor"}
                        className="text-line-strong"
                      />

                      {cell.kind === "building" && (
                        <g aria-hidden="true">
                          <path d={`M${cell_center.x - 15} ${cell_center.y + 13} V${cell_center.y - 9} H${cell_center.x + 2} V${cell_center.y + 13} M${cell_center.x + 2} ${cell_center.y + 13} V${cell_center.y - 2} H${cell_center.x + 15} V${cell_center.y + 13}`} className="fill-none stroke-foreground" strokeLinecap="round" strokeLinejoin="round" />
                          <path d={`M${cell_center.x - 10} ${cell_center.y - 3} H${cell_center.x - 5} M${cell_center.x - 10} ${cell_center.y + 4} H${cell_center.x - 5} M${cell_center.x + 7} ${cell_center.y + 4} H${cell_center.x + 11}`} className="stroke-foreground" strokeLinecap="round" />
                        </g>
                      )}

                      {cell.kind === "forest" && (
                        <g aria-hidden="true">
                          <path d={`M${cell_center.x - 12} ${cell_center.y + 10} L${cell_center.x - 4} ${cell_center.y - 10} L${cell_center.x + 4} ${cell_center.y + 10} Z M${cell_center.x + 1} ${cell_center.y + 10} L${cell_center.x + 10} ${cell_center.y - 13} L${cell_center.x + 18} ${cell_center.y + 10} Z`} className="fill-none stroke-foreground" strokeLinejoin="round" />
                          <path d={`M${cell_center.x - 4} ${cell_center.y + 10} V${cell_center.y + 16} M${cell_center.x + 10} ${cell_center.y + 10} V${cell_center.y + 16}`} className="stroke-foreground" />
                        </g>
                      )}

                      {cell.kind === "agent" && (
                        <g aria-hidden="true">
                          <path
                            d={`M${cell_center.x - 13} ${cell_center.y + 18} V${cell_center.y} C${cell_center.x - 13} ${cell_center.y - 10} ${cell_center.x - 7} ${cell_center.y - 16} ${cell_center.x} ${cell_center.y - 16} C${cell_center.x + 7} ${cell_center.y - 16} ${cell_center.x + 13} ${cell_center.y - 10} ${cell_center.x + 13} ${cell_center.y} V${cell_center.y + 18} L${cell_center.x + 7} ${cell_center.y + 13} L${cell_center.x} ${cell_center.y + 18} L${cell_center.x - 7} ${cell_center.y + 13} Z`}
                            fill={city_node.accent}
                          />
                          <circle cx={cell_center.x - 4.5} cy={cell_center.y - 2.5} r="1.6" className="fill-background" />
                          <circle cx={cell_center.x + 4.5} cy={cell_center.y - 2.5} r="1.6" className="fill-background" />
                        </g>
                      )}
                    </motion.g>
                  );
                })}
              </motion.g>
            );
          })}

          <text x="600" y="386" textAnchor="middle" className="fill-text-subtle text-[8px]">
            {t("hero.ecosystem.caption")}
          </text>
        </svg>

        <svg viewBox="0 0 360 300" className="h-auto w-full sm:hidden" aria-hidden="true">
          <circle cx="170" cy="18" r="7" className="fill-background stroke-foreground" />
          <circle cx="180" cy="14" r="7" className="fill-background stroke-foreground" />
          <circle cx="190" cy="18" r="7" className="fill-background stroke-foreground" />
          <text x="180" y="43" textAnchor="middle" className="fill-foreground text-[9px] font-semibold">Federation</text>

          <path d="M173 52 C142 72 106 67 78 93" className="fill-none stroke-line-strong opacity-35" />
          <path d="M187 52 C218 72 254 67 282 93" className="fill-none stroke-line-strong opacity-35" />
          <path d="M180 54 C180 120 186 166 188 207" className="fill-none stroke-line-strong opacity-25" />

          {mobile_city_tiles.map((city_node) => (
            <g key={city_node.key}>
              {city_node.cells.map((cell) => {
                const cell_center = hex_center(city_node.origin.x, city_node.origin.y, 18, cell.q, cell.row);

                return (
                  <g key={`${cell.q}-${cell.row}`}>
                    <path d={hex_path(cell_center.x, cell_center.y, 18)} fill="transparent" className="stroke-line-strong opacity-75" />
                    {cell.kind === "agent" && (
                      <>
                        <path
                          d={`M${cell_center.x - 7} ${cell_center.y + 10} V${cell_center.y} C${cell_center.x - 7} ${cell_center.y - 6} ${cell_center.x - 4} ${cell_center.y - 9} ${cell_center.x} ${cell_center.y - 9} C${cell_center.x + 4} ${cell_center.y - 9} ${cell_center.x + 7} ${cell_center.y - 6} ${cell_center.x + 7} ${cell_center.y} V${cell_center.y + 10} L${cell_center.x + 4} ${cell_center.y + 7} L${cell_center.x} ${cell_center.y + 10} L${cell_center.x - 4} ${cell_center.y + 7} Z`}
                          fill={city_node.accent}
                        />
                        <circle cx={cell_center.x - 2.4} cy={cell_center.y - 1.5} r="0.9" className="fill-background" />
                        <circle cx={cell_center.x + 2.4} cy={cell_center.y - 1.5} r="0.9" className="fill-background" />
                      </>
                    )}
                    {cell.kind === "building" && (
                      <path d={`M${cell_center.x - 7} ${cell_center.y + 8} V${cell_center.y - 5} H${cell_center.x + 1} V${cell_center.y + 8} M${cell_center.x + 1} ${cell_center.y + 8} V${cell_center.y - 1} H${cell_center.x + 7} V${cell_center.y + 8}`} className="fill-none stroke-foreground" />
                    )}
                    {cell.kind === "forest" && (
                      <path d={`M${cell_center.x - 7} ${cell_center.y + 7} L${cell_center.x} ${cell_center.y - 8} L${cell_center.x + 7} ${cell_center.y + 7} Z M${cell_center.x} ${cell_center.y + 7} V${cell_center.y + 11}`} className="fill-none stroke-foreground" />
                    )}
                  </g>
                );
              })}
              <text
                x={city_node.label.x}
                y={city_node.label.y}
                textAnchor={city_node.key === "research" ? "end" : "start"}
                className="fill-text-soft text-[6px]"
              >
                {t(`hero.ecosystem.cities.${city_node.key}.name`)}
              </text>
            </g>
          ))}

          <text x="180" y="294" textAnchor="middle" className="fill-text-subtle text-[6px]">{t("hero.ecosystem.caption")}</text>
        </svg>
      </div>

      <figcaption id="home-hero-cover-caption" className="sr-only">
        {t("hero.coverLabel")}
      </figcaption>
    </figure>
  );
}

export default HomeHeroCover;

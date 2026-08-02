/**
 * 首页产品世界的连续蜂巢大陆动画。
 *
 * Agent 集成能力后让地块从中心连续生长；大陆内部形成多座 City，最后通过
 * 加粗真实蜂巢边缘表达 Federation，全程不引入独立容器或外部轮廓。
 */

import { useRef, type FC } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import {
  home_product_world_city_edges,
  home_product_world_federation_edges,
  home_product_world_growth_groups,
  home_product_world_origin,
} from "@/lib/home-product-world-layout";
import {
  home_world_agent_path,
  home_world_hex_center,
  home_world_hex_path,
} from "@/lib/home-world-geometry";

const capability_nodes = [
  { key: "tool", x: 390, y: 205 },
  { key: "skill", x: 810, y: 205 },
  { key: "memory", x: 315, y: 355 },
  { key: "task", x: 885, y: 355 },
  { key: "service", x: 410, y: 515 },
  { key: "model", x: 790, y: 515 },
] as const;

/** 渲染大陆地块中的 Agent、建筑与自然环境。 */
function render_cell_content(
  content: string,
  center_x: number,
  center_y: number,
  radius: number,
  accent: string,
) {
  if (content === "agent") {
    return (
      <g>
        <path d={home_world_agent_path(center_x, center_y, radius * 0.78)} fill={accent} />
        <circle cx={center_x - radius * 0.1} cy={center_y - radius * 0.06} r={radius * 0.032} className="fill-background" />
        <circle cx={center_x + radius * 0.1} cy={center_y - radius * 0.06} r={radius * 0.032} className="fill-background" />
      </g>
    );
  }

  if (content === "forest") {
    return (
      <g className="fill-none stroke-foreground" strokeOpacity="0.48">
        <path d={`M${center_x - radius * 0.3} ${center_y + radius * 0.24} L${center_x - radius * 0.08} ${center_y - radius * 0.3} L${center_x + radius * 0.12} ${center_y + radius * 0.24} Z`} />
        <path d={`M${center_x + radius * 0.04} ${center_y + radius * 0.24} L${center_x + radius * 0.27} ${center_y - radius * 0.36} L${center_x + radius * 0.48} ${center_y + radius * 0.24} Z`} />
      </g>
    );
  }

  if (content === "building") {
    return (
      <g className="fill-none stroke-foreground" strokeOpacity="0.48">
        <path d={`M${center_x - radius * 0.34} ${center_y + radius * 0.3} V${center_y - radius * 0.26} H${center_x + radius * 0.02} V${center_y + radius * 0.3}`} />
        <path d={`M${center_x + radius * 0.02} ${center_y + radius * 0.3} V${center_y - radius * 0.06} H${center_x + radius * 0.34} V${center_y + radius * 0.3}`} />
      </g>
    );
  }

  if (content === "workshop") {
    return (
      <g className="fill-none stroke-foreground" strokeOpacity="0.52">
        <path d={`M${center_x - radius * 0.36} ${center_y - radius * 0.22} H${center_x + radius * 0.2} V${center_y + radius * 0.28} H${center_x - radius * 0.36} Z`} />
        <path d={`M${center_x - radius * 0.18} ${center_y - radius * 0.38} H${center_x + radius * 0.38} V${center_y + radius * 0.12}`} />
        <path d={`M${center_x - radius * 0.08} ${center_y - radius * 0.08} H${center_x + radius * 0.08} M${center_x - radius * 0.08} ${center_y + radius * 0.08} H${center_x + radius * 0.08}`} />
      </g>
    );
  }

  if (content === "plaza") {
    return (
      <g className="fill-none stroke-foreground" strokeOpacity="0.48">
        <path d={`M${center_x} ${center_y - radius * 0.3} L${center_x + radius * 0.3} ${center_y} L${center_x} ${center_y + radius * 0.3} L${center_x - radius * 0.3} ${center_y} Z`} />
        <path d={`M${center_x} ${center_y - radius * 0.3} V${center_y - radius * 0.46} M${center_x + radius * 0.3} ${center_y} H${center_x + radius * 0.46} M${center_x} ${center_y + radius * 0.3} V${center_y + radius * 0.46} M${center_x - radius * 0.3} ${center_y} H${center_x - radius * 0.46}`} />
      </g>
    );
  }

  return null;
}

/** 渲染同一扩散阶段中的连续大陆地块。 */
function render_growth_group(
  cells: (typeof home_product_world_growth_groups)[number],
  opacity: number | MotionValue<number>,
) {
  return (
    <motion.g style={{ opacity }}>
      {cells.map((cell) => {
        const center = home_world_hex_center(
          home_product_world_origin.x,
          home_product_world_origin.y,
          home_product_world_origin.radius,
          cell.q,
          cell.row,
        );

        return (
          <g key={cell.key}>
            <path
              d={home_world_hex_path(center.x, center.y, home_product_world_origin.radius)}
              fill={cell.accent}
              fillOpacity={cell.fill_opacity}
              className="stroke-line-strong"
              strokeWidth="0.85"
            />
            {cell.q === 0 && cell.row === 0
              ? null
              : render_cell_content(
                  cell.content,
                  center.x,
                  center.y,
                  home_product_world_origin.radius,
                  cell.accent,
                )}
          </g>
        );
      })}
    </motion.g>
  );
}

/** Product World 通过大陆连续生长解释 Downcity 的组织尺度。 */
export const HomeProductWorldSection: FC = () => {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const reduce_motion = useReducedMotion();
  const section_ref = useRef<HTMLElement>(null);
  const { scrollYProgress: scroll_y_progress } = useScroll({
    target: section_ref,
    offset: ["start start", "end end"],
  });
  const smooth_progress = useSpring(scroll_y_progress, {
    stiffness: 88,
    damping: 30,
    mass: 0.4,
    restDelta: 0.0005,
  });

  const capability_opacity = useTransform(smooth_progress, [0, 0.045, 0.25, 0.35], [0, 1, 1, 0]);
  const capability_scale = useTransform(smooth_progress, [0, 0.08, 0.3, 0.36], [1.12, 1, 0.3, 0.12]);
  const capability_rotate = useTransform(smooth_progress, [0, 0.36], [-7, 13]);
  const capability_path = useTransform(smooth_progress, [0.015, 0.15, 0.3], [0, 1, 1]);
  const integration_ring_opacity = useTransform(smooth_progress, [0.04, 0.13, 0.29, 0.38], [0, 0.8, 0.55, 0]);
  const integration_ring_scale = useTransform(smooth_progress, [0.04, 0.36], [0.76, 1.42]);

  const center_city_opacity = useTransform(smooth_progress, [0.27, 0.39], [0, 1]);
  const inner_land_opacity = useTransform(smooth_progress, [0.38, 0.5], [0, 1]);
  const middle_land_opacity = useTransform(smooth_progress, [0.48, 0.62], [0, 1]);
  const outer_land_opacity = useTransform(smooth_progress, [0.58, 0.74], [0, 1]);
  const continent_opacity = useTransform(smooth_progress, [0.68, 0.84], [0, 1]);
  const city_boundary_opacity = useTransform(smooth_progress, [0.46, 0.68], [0, 0.72]);
  const federation_boundary_opacity = useTransform(smooth_progress, [0.7, 0.9], [0, 1]);
  const federation_boundary_path = useTransform(smooth_progress, [0.7, 0.96], [0, 1]);
  const world_camera_scale = useTransform(
    smooth_progress,
    [0, 0.34, 0.62, 0.8, 1],
    [1.12, 1.12, 1, 0.88, 0.78],
  );

  const agent_scale = useTransform(smooth_progress, [0, 0.18, 0.4, 0.72, 1], [1, 1.04, 0.82, 0.68, 0.62]);
  const agent_glow_opacity = useTransform(smooth_progress, [0, 0.1, 0.38, 0.72, 1], [0.12, 0.28, 0.14, 0.08, 0.1]);
  const agent_stage_opacity = useTransform(smooth_progress, [0, 0.04, 0.12], [1, 1, 0]);
  const capabilities_stage_opacity = useTransform(smooth_progress, [0.05, 0.12, 0.29, 0.37], [0, 1, 1, 0]);
  const city_stage_opacity = useTransform(smooth_progress, [0.31, 0.4, 0.62, 0.72], [0, 1, 1, 0]);
  const federation_stage_opacity = useTransform(smooth_progress, [0.68, 0.78, 1], [0, 1, 1]);
  const growth_opacities = reduce_motion
    ? [1, 1, 1, 1, 1]
    : [center_city_opacity, inner_land_opacity, middle_land_opacity, outer_land_opacity, continent_opacity];

  return (
    <section
      ref={section_ref}
      className={`relative bg-background ${reduce_motion ? "h-svh min-h-[760px]" : "h-[540vh] md:h-[570vh]"}`}
    >
      <div className="sticky top-0 h-svh min-h-[680px] overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            backgroundImage: "linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(circle at center, black, transparent 76%)",
          }}
        />
        <div className="absolute inset-x-5 top-20 z-20 flex items-center justify-between md:inset-x-8 lg:inset-x-20">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-text-subtle">{t("productWorld.sectionLabel")}</p>
          {!reduce_motion ? (
            <p className="flex items-center gap-2 text-[0.64rem] uppercase tracking-[0.08em] text-text-subtle">
              <span className="h-px w-8 bg-line-strong" />
              {t("productWorld.scrollHint")}
            </p>
          ) : null}
        </div>

        <h2 className="sr-only">{t("productWorld.title")}</h2>
        <p className="sr-only">{t("productWorld.description")}</p>

        <div className="absolute inset-0 flex items-center justify-center pt-10 md:pt-16">
          <svg viewBox="0 0 1200 720" className="h-full w-[190vw] max-w-none shrink-0 md:w-full" role="img" aria-label={t("productWorld.description")}>
            <motion.g
              style={{
                opacity: reduce_motion ? 0 : capability_opacity,
                scale: reduce_motion ? 0.12 : capability_scale,
                rotate: reduce_motion ? 24 : capability_rotate,
                transformOrigin: "600px 360px",
                willChange: "transform, opacity",
              }}
            >
              <ellipse cx="600" cy="360" rx="300" ry="220" className="fill-none stroke-[#b45d4c]" strokeDasharray="3 8" opacity="0.3" />
              {capability_nodes.map((node) => (
                <g key={node.key}>
                  <motion.path d={`M${node.x} ${node.y} Q600 360 600 360`} className="fill-none stroke-[#b45d4c]" opacity="0.45" style={{ pathLength: reduce_motion ? 1 : capability_path }} />
                  <circle cx={node.x} cy={node.y} r="34" className="fill-background stroke-[#b45d4c]" strokeWidth="1.2" />
                  <circle cx={node.x} cy={node.y} r="25" fill="#b45d4c" fillOpacity="0.05" />
                  <text x={node.x} y={node.y + 4} textAnchor="middle" className="fill-text-soft text-[11px] font-medium">{t(`productWorld.labels.${node.key}`)}</text>
                </g>
              ))}
            </motion.g>

            <motion.circle
              cx="600"
              cy="360"
              r="82"
              fill="none"
              stroke="#4f6f9f"
              strokeWidth="1.5"
              style={{
                opacity: reduce_motion ? 0 : integration_ring_opacity,
                scale: integration_ring_scale,
                transformOrigin: "600px 360px",
              }}
            />

            <motion.g
              style={{
                scale: reduce_motion ? 0.78 : world_camera_scale,
                transformOrigin: "600px 360px",
                willChange: "transform",
              }}
            >
              {home_product_world_growth_groups.map((cells, index) => (
                <g key={`growth-${index}`}>
                  {render_growth_group(cells, growth_opacities[index])}
                </g>
              ))}

              <motion.g style={{ opacity: reduce_motion ? 0.72 : city_boundary_opacity }}>
                {home_product_world_city_edges.map((path, index) => (
                  <path key={`city-edge-${index}`} d={path} className="fill-none stroke-foreground" strokeOpacity="0.34" strokeWidth="1.7" strokeLinecap="round" />
                ))}
              </motion.g>

              <motion.g style={{ opacity: reduce_motion ? 1 : federation_boundary_opacity }}>
                {home_product_world_federation_edges.map((path, index) => (
                  <motion.path
                    key={`federation-edge-${index}`}
                    d={path}
                    className="fill-none stroke-foreground"
                    strokeWidth="4.6"
                    strokeLinecap="round"
                    style={{ pathLength: reduce_motion ? 1 : federation_boundary_path }}
                  />
                ))}
              </motion.g>
            </motion.g>

            <motion.g
              style={{
                scale: reduce_motion ? 0.62 : agent_scale,
                transformOrigin: "600px 360px",
              }}
            >
              <motion.circle cx="600" cy="360" r="72" fill="#4f6f9f" style={{ opacity: reduce_motion ? 0.1 : agent_glow_opacity }} />
              <path d={home_world_agent_path(600, 360, 68)} fill="#4f6f9f" />
              <circle cx="591" cy="354.5" r="2.8" className="fill-background" />
              <circle cx="609" cy="354.5" r="2.8" className="fill-background" />
              <text x="600" y="425" textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{t("productWorld.labels.agent")}</text>
            </motion.g>
          </svg>
        </div>

        <div aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-[9vh] z-20 mx-auto h-8 max-w-5xl text-center md:inset-x-8 md:bottom-[7vh]">
          <motion.p style={{ opacity: reduce_motion ? 0 : agent_stage_opacity }} className="absolute inset-x-0 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-soft">{t("productWorld.labels.agent")}</motion.p>
          <motion.p style={{ opacity: reduce_motion ? 0 : capabilities_stage_opacity }} className="absolute inset-x-0 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-soft">{t("productWorld.labels.capabilities")}</motion.p>
          <motion.p style={{ opacity: reduce_motion ? 0 : city_stage_opacity }} className="absolute inset-x-0 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-soft">{t("productWorld.labels.city")}</motion.p>
          <motion.p style={{ opacity: reduce_motion ? 1 : federation_stage_opacity }} className="absolute inset-x-0 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-soft">{t("productWorld.labels.federation")}</motion.p>
        </div>
      </div>
    </section>
  );
};

export default HomeProductWorldSection;

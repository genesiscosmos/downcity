/**
 * 首页产品世界连续滚动叙事。
 *
 * 动画始终围绕同一个 Agent 展开：Agent 被唤醒、吸收工作能力、落入第一块
 * City 地块，随后蜂巢扩张并迎来更多 Agent，最后镜头拉远形成 Federation。
 * 页面滚动是唯一进度源，不维护独立场景状态，也不使用说明面板或切换控件。
 */

import { useRef, useState, type FC } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
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

const ring_one_cells = [
  { q: 1, row: 0, kind: "building" },
  { q: 0, row: 1, kind: "agent" },
  { q: -1, row: 1, kind: "forest" },
  { q: -1, row: 0, kind: "agent" },
  { q: 0, row: -1, kind: "empty" },
  { q: 1, row: -1, kind: "interface" },
] as const;

const ring_two_cells = [
  { q: 2, row: 0, kind: "empty" },
  { q: 1, row: 1, kind: "agent" },
  { q: 0, row: 2, kind: "building" },
  { q: -1, row: 2, kind: "empty" },
  { q: -2, row: 2, kind: "forest" },
  { q: -2, row: 1, kind: "agent" },
  { q: -2, row: 0, kind: "empty" },
  { q: -1, row: -1, kind: "building" },
  { q: 0, row: -2, kind: "empty" },
  { q: 1, row: -2, kind: "agent" },
  { q: 2, row: -2, kind: "forest" },
  { q: 2, row: -1, kind: "empty" },
] as const;

const remote_city_cells = [
  { q: 0, row: 0 },
  { q: 1, row: 0 },
  { q: 0, row: 1 },
  { q: -1, row: 1 },
  { q: -1, row: 0 },
  { q: 0, row: -1 },
  { q: 1, row: -1 },
] as const;

const story_keys = ["awaken", "gather", "settle", "expand", "connect"] as const;

/** Product World 通过空间尺度的连续变化解释 Downcity 的产品世界。 */
export const HomeProductWorldSection: FC = () => {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const reduce_motion = useReducedMotion();
  const section_ref = useRef<HTMLElement>(null);
  const [active_story_index, set_active_story_index] = useState(-1);
  const { scrollYProgress: scroll_y_progress } = useScroll({
    target: section_ref,
    offset: ["start start", "end end"],
  });

  const agent_opacity = useTransform(scroll_y_progress, [0.08, 0.16], [0, 1]);
  const agent_scale = useTransform(scroll_y_progress, [0.08, 0.18, 0.35, 0.42], [0.62, 1, 1.06, 1]);
  const agent_y = useTransform(scroll_y_progress, [0.38, 0.5], [-42, 0]);
  const agent_glow_opacity = useTransform(scroll_y_progress, [0.12, 0.2, 0.34, 0.44], [0, 0.22, 0.14, 0]);

  const capability_opacity = useTransform(scroll_y_progress, [0.19, 0.25, 0.36, 0.42], [0, 1, 1, 0]);
  const capability_scale = useTransform(scroll_y_progress, [0.24, 0.41], [1, 0.12]);
  const capability_rotate = useTransform(scroll_y_progress, [0.24, 0.41], [0, 24]);
  const absorption_pulse_opacity = useTransform(scroll_y_progress, [0.33, 0.37, 0.44], [0, 0.6, 0]);
  const absorption_pulse_scale = useTransform(scroll_y_progress, [0.33, 0.44], [0.65, 1.65]);

  const center_cell_opacity = useTransform(scroll_y_progress, [0.38, 0.47], [0, 1]);
  const center_cell_path = useTransform(scroll_y_progress, [0.38, 0.49], [0, 1]);
  const ring_one_opacity = useTransform(scroll_y_progress, [0.49, 0.58], [0, 1]);
  const ring_one_scale = useTransform(scroll_y_progress, [0.49, 0.6], [0.72, 1]);
  const ring_two_opacity = useTransform(scroll_y_progress, [0.58, 0.7], [0, 1]);
  const ring_two_scale = useTransform(scroll_y_progress, [0.58, 0.72], [0.78, 1]);
  const city_content_opacity = useTransform(scroll_y_progress, [0.57, 0.69], [0, 1]);

  const current_city_scale = useTransform(scroll_y_progress, [0.72, 0.88], [1, 0.52]);
  const current_city_x = useTransform(scroll_y_progress, [0.72, 0.88], [0, -210]);
  const current_city_y = useTransform(scroll_y_progress, [0.72, 0.88], [0, 44]);
  const remote_cities_opacity = useTransform(scroll_y_progress, [0.76, 0.88], [0, 1]);
  const remote_cities_scale = useTransform(scroll_y_progress, [0.76, 0.9], [0.72, 1]);
  const federation_opacity = useTransform(scroll_y_progress, [0.78, 0.88], [0, 1]);
  const federation_path = useTransform(scroll_y_progress, [0.82, 0.96], [0, 1]);

  const current_city_origin = { x: 600, y: 360 };
  const current_city_radius = 52;

  useMotionValueEvent(scroll_y_progress, "change", (latest_progress) => {
    if (reduce_motion) return;

    let next_story_index = -1;
    if (latest_progress >= 0.12) next_story_index = 0;
    if (latest_progress >= 0.24) next_story_index = 1;
    if (latest_progress >= 0.41) next_story_index = 2;
    if (latest_progress >= 0.56) next_story_index = 3;
    if (latest_progress >= 0.78) next_story_index = 4;

    set_active_story_index((current_story_index) =>
      current_story_index === next_story_index ? current_story_index : next_story_index,
    );
  });

  const active_story_key = active_story_index >= 0 ? story_keys[active_story_index] : null;

  return (
    <section
      ref={section_ref}
      className={`relative border-t border-line bg-background ${reduce_motion ? "h-svh min-h-[760px]" : "h-[520vh] md:h-[560vh]"}`}
    >
      <div className="sticky top-0 h-svh min-h-[680px] overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(circle at center, black, transparent 74%)",
          }}
        />
        <div className="absolute inset-x-5 top-20 z-20 flex items-center justify-between md:inset-x-8 lg:inset-x-20">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-text-subtle">
            {t("productWorld.sectionLabel")}
          </p>
          {!reduce_motion ? (
            <p className="flex items-center gap-2 text-[0.64rem] uppercase tracking-[0.08em] text-text-subtle">
              <span className="h-px w-8 bg-line-strong" />
              {t("productWorld.scrollHint")}
            </p>
          ) : null}
        </div>

        <AnimatePresence initial={false}>
          {active_story_index < 0 ? (
            <motion.header
              key="product-world-intro"
              initial={reduce_motion ? false : { opacity: 0, scale: 0.97, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce_motion ? undefined : { opacity: 0, scale: 0.94, y: -56 }}
              transition={{ duration: reduce_motion ? 0 : 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-x-5 top-[18vh] z-20 mx-auto max-w-5xl text-center md:inset-x-8 md:top-[16vh]"
            >
              <h2 className="font-serif text-[clamp(2.2rem,6vw,5.4rem)] font-bold leading-[0.98] tracking-[-0.045em] text-foreground">
                {t("productWorld.title")}
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-sm leading-[1.75] text-text-soft md:text-base">
                {t("productWorld.description")}
              </p>
            </motion.header>
          ) : null}
        </AnimatePresence>

        <div className="absolute inset-0 flex items-center justify-center pt-10 md:pt-16">
          <svg
            viewBox="0 0 1200 720"
            className="h-full w-[170vw] max-w-none shrink-0 md:w-full"
            role="img"
            aria-label={t("productWorld.description")}
          >
            <motion.g
              style={{
                opacity: reduce_motion ? 1 : capability_opacity,
                scale: reduce_motion ? 0.12 : capability_scale,
                rotate: reduce_motion ? 24 : capability_rotate,
                transformOrigin: "600px 320px",
              }}
            >
              <ellipse cx="600" cy="345" rx="300" ry="220" className="fill-none stroke-[#b45d4c]" strokeDasharray="3 8" opacity="0.3" />
              {capability_nodes.map((node) => (
                <g key={node.key}>
                  <path d={`M${node.x} ${node.y} Q600 345 600 320`} className="fill-none stroke-[#b45d4c]" opacity="0.45" />
                  <circle cx={node.x} cy={node.y} r="34" className="fill-background stroke-[#b45d4c]" strokeWidth="1.2" />
                  <circle cx={node.x} cy={node.y} r="25" fill="#b45d4c" fillOpacity="0.05" />
                  <text x={node.x} y={node.y + 4} textAnchor="middle" className="fill-text-soft text-[11px] font-medium">
                    {t(`productWorld.labels.${node.key}`)}
                  </text>
                </g>
              ))}
            </motion.g>

            <motion.circle
              cx="600"
              cy="320"
              r="82"
              fill="none"
              stroke="#4f6f9f"
              strokeWidth="1.5"
              style={{
                opacity: reduce_motion ? 0 : absorption_pulse_opacity,
                scale: absorption_pulse_scale,
                transformOrigin: "600px 320px",
              }}
            />

            <motion.g
              style={{
                scale: reduce_motion ? 0.52 : current_city_scale,
                x: reduce_motion ? -210 : current_city_x,
                y: reduce_motion ? 44 : current_city_y,
                transformOrigin: `${current_city_origin.x}px ${current_city_origin.y}px`,
              }}
            >
              <motion.path
                d={home_world_hex_path(current_city_origin.x, current_city_origin.y, current_city_radius)}
                fill="#4f6f9f"
                stroke="#4f6f9f"
                strokeWidth="1.4"
                style={{
                  opacity: reduce_motion ? 1 : center_cell_opacity,
                  pathLength: reduce_motion ? 1 : center_cell_path,
                  fillOpacity: 0.06,
                }}
              />

              <motion.g
                style={{
                  opacity: reduce_motion ? 1 : ring_one_opacity,
                  scale: reduce_motion ? 1 : ring_one_scale,
                  transformOrigin: `${current_city_origin.x}px ${current_city_origin.y}px`,
                }}
              >
                {ring_one_cells.map((cell) => {
                  const center = home_world_hex_center(
                    current_city_origin.x,
                    current_city_origin.y,
                    current_city_radius,
                    cell.q,
                    cell.row,
                  );

                  return (
                    <path
                      key={`${cell.q}-${cell.row}`}
                      d={home_world_hex_path(center.x, center.y, current_city_radius)}
                      fill="transparent"
                      className="stroke-line-strong"
                    />
                  );
                })}
              </motion.g>

              <motion.g
                style={{
                  opacity: reduce_motion ? 1 : ring_two_opacity,
                  scale: reduce_motion ? 1 : ring_two_scale,
                  transformOrigin: `${current_city_origin.x}px ${current_city_origin.y}px`,
                }}
              >
                {ring_two_cells.map((cell) => {
                  const center = home_world_hex_center(
                    current_city_origin.x,
                    current_city_origin.y,
                    current_city_radius,
                    cell.q,
                    cell.row,
                  );

                  return (
                    <path
                      key={`${cell.q}-${cell.row}`}
                      d={home_world_hex_path(center.x, center.y, current_city_radius)}
                      fill="transparent"
                      className="stroke-line-strong"
                    />
                  );
                })}
              </motion.g>

              <motion.g style={{ opacity: reduce_motion ? 1 : city_content_opacity }}>
                {[...ring_one_cells, ...ring_two_cells].map((cell) => {
                  if (cell.kind === "empty") return null;

                  const center = home_world_hex_center(
                    current_city_origin.x,
                    current_city_origin.y,
                    current_city_radius,
                    cell.q,
                    cell.row,
                  );

                  if (cell.kind === "agent") {
                    return (
                      <g key={`content-${cell.q}-${cell.row}`}>
                        <path d={home_world_agent_path(center.x, center.y, 38)} fill="#3f7d5b" />
                        <circle cx={center.x - 5} cy={center.y - 3} r="1.8" className="fill-background" />
                        <circle cx={center.x + 5} cy={center.y - 3} r="1.8" className="fill-background" />
                      </g>
                    );
                  }

                  if (cell.kind === "forest") {
                    return (
                      <g key={`content-${cell.q}-${cell.row}`} className="fill-none stroke-foreground">
                        <path d={`M${center.x - 18} ${center.y + 13} L${center.x - 7} ${center.y - 15} L${center.x + 4} ${center.y + 13} Z`} />
                        <path d={`M${center.x} ${center.y + 13} L${center.x + 13} ${center.y - 20} L${center.x + 25} ${center.y + 13} Z`} />
                      </g>
                    );
                  }

                  return (
                    <g key={`content-${cell.q}-${cell.row}`} className="fill-none stroke-foreground">
                      <path d={`M${center.x - 19} ${center.y + 17} V${center.y - 12} H${center.x + 2} V${center.y + 17}`} />
                      <path d={`M${center.x + 2} ${center.y + 17} V${center.y - 3} H${center.x + 19} V${center.y + 17}`} />
                      <path d={`M${center.x - 13} ${center.y - 4} H${center.x - 6} M${center.x - 13} ${center.y + 5} H${center.x - 6}`} />
                    </g>
                  );
                })}
              </motion.g>

              <motion.g
                style={{
                  opacity: reduce_motion ? 1 : agent_opacity,
                  scale: reduce_motion ? 1 : agent_scale,
                  y: reduce_motion ? 0 : agent_y,
                  transformOrigin: `${current_city_origin.x}px ${current_city_origin.y}px`,
                }}
              >
                <motion.circle
                  cx={current_city_origin.x}
                  cy={current_city_origin.y}
                  r="78"
                  fill="#4f6f9f"
                  style={{ opacity: reduce_motion ? 0.1 : agent_glow_opacity }}
                />
                <path d={home_world_agent_path(current_city_origin.x, current_city_origin.y, 72)} fill="#4f6f9f" />
                <circle cx={current_city_origin.x - 10} cy={current_city_origin.y - 6} r="3" className="fill-background" />
                <circle cx={current_city_origin.x + 10} cy={current_city_origin.y - 6} r="3" className="fill-background" />
                <text x={current_city_origin.x} y={current_city_origin.y + 70} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">
                  {t("productWorld.labels.agent")}
                </text>
              </motion.g>
            </motion.g>

            <motion.g
              style={{
                opacity: reduce_motion ? 1 : remote_cities_opacity,
                scale: reduce_motion ? 1 : remote_cities_scale,
                transformOrigin: "750px 380px",
              }}
            >
              {[
                { x: 600, y: 404, accent: "#b45d4c" },
                { x: 810, y: 404, accent: "#3f7d5b" },
              ].map((city) => (
                <g key={city.x}>
                  {remote_city_cells.map((cell) => {
                    const center = home_world_hex_center(city.x, city.y, 34, cell.q, cell.row);
                    return (
                      <path
                        key={`${cell.q}-${cell.row}`}
                        d={home_world_hex_path(center.x, center.y, 34)}
                        fill="transparent"
                        stroke={city.accent}
                        strokeOpacity="0.72"
                      />
                    );
                  })}
                  <path d={home_world_agent_path(city.x, city.y, 28)} fill={city.accent} />
                  <circle cx={city.x - 3.6} cy={city.y - 2.2} r="1.2" className="fill-background" />
                  <circle cx={city.x + 3.6} cy={city.y - 2.2} r="1.2" className="fill-background" />
                  <text x={city.x} y={city.y + 105} textAnchor="middle" className="fill-text-soft text-[12px]">
                    {t("productWorld.labels.city")}
                  </text>
                </g>
              ))}
            </motion.g>

            <motion.g style={{ opacity: reduce_motion ? 1 : federation_opacity }}>
              <motion.path
                d="M600 120 C500 160 430 220 390 300 M600 120 C600 190 600 240 600 300 M600 120 C680 160 750 220 810 300"
                className="fill-none stroke-foreground"
                strokeWidth="1.3"
                style={{ pathLength: reduce_motion ? 1 : federation_path }}
              />
              <circle cx="580" cy="96" r="14" className="fill-background stroke-foreground" />
              <circle cx="600" cy="88" r="14" className="fill-background stroke-foreground" />
              <circle cx="620" cy="96" r="14" className="fill-background stroke-foreground" />
              <text x="600" y="145" textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
                {t("productWorld.labels.federation")}
              </text>
            </motion.g>
          </svg>
        </div>

        <div className="pointer-events-none absolute inset-x-5 bottom-[9vh] z-20 mx-auto max-w-5xl text-center md:inset-x-8 md:bottom-[7vh]">
          <AnimatePresence initial={false} mode="sync">
            {active_story_key ? (
              <motion.p
                key={active_story_key}
                initial={{ opacity: 0, y: 30, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -24, scale: 0.985 }}
                transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-x-0 bottom-0 font-serif text-[clamp(1.35rem,3.5vw,3.2rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground"
              >
                {t(`productWorld.story.${active_story_key}`)}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
};

export default HomeProductWorldSection;

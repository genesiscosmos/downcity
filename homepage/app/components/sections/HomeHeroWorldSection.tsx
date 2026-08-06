/**
 * 首页 Hero 与 Product World 的统一双屏滚动舞台。
 *
 * 一个 318svh Section 为 100svh Sticky 舞台提供两个完整屏幕的受控叙事距离，以及
 * 18svh 的地图末端接缝。完成 Federation 的当前手势会停留在地图，
 * 用户的下一次独立向下输入才会使 Sticky 舞台离场并进入下一 Section。
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { IconArrowRight } from "@tabler/icons-react";
import { motion, useMotionValueEvent, useReducedMotion, useTransform } from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { HomeHeroAgentActor } from "@/components/sections/HomeHeroAgentActor";
import { HomeHeroCityStage, home_hero_agent_position, home_hero_city_floor_offset } from "@/components/sections/HomeHeroCityStage";
import { HomeProductWorldSection } from "@/components/sections/HomeProductWorldSection";
import { HomeProductWorldInspector } from "@/components/sections/HomeProductWorldInspector";
import { homepage_positioning } from "@/lib/homepage-positioning";
import { use_home_hero_world_progress } from "@/hooks/use-home-hero-world-progress";
import type { HomeProductWorldInspection } from "@/types/home/HomeProductWorld";

const home_hero_agent_accent = "#4f6f9f";

/** Hero 文案、城市与产品世界共用唯一滚动进度。 */
export function HomeHeroWorldSection() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const positioning = homepage_positioning[locale];
  const reduce_motion = useReducedMotion();
  const section_ref = useRef<HTMLElement>(null);
  const { world_progress, seam_progress } = use_home_hero_world_progress(section_ref, Boolean(reduce_motion));
  const [map_is_interactive, set_map_is_interactive] = useState(false);
  const [preview_inspection, set_preview_inspection] = useState<HomeProductWorldInspection | null>(null);
  const [pinned_inspection, set_pinned_inspection] = useState<HomeProductWorldInspection | null>(null);

  useMotionValueEvent(world_progress, "change", (progress) => set_map_is_interactive(progress >= 0.72));

  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        set_preview_inspection(null);
        set_pinned_inspection(null);
      }
    };
    window.addEventListener("keydown", handle_key_down);
    return () => window.removeEventListener("keydown", handle_key_down);
  }, []);

  const start_position_y = home_hero_agent_position.y + home_hero_city_floor_offset;
  const learn_more_path = locale === "zh" ? "/zh/product" : "/product";
  const hero_dom_track_y = useTransform(world_progress, [0, 0.34], ["0svh", "-100svh"]);
  const hero_scene_track_y = useTransform(world_progress, [0, 0.34], [0, -720]);

  const agent_x = useTransform(world_progress, [0, 0.34], [home_hero_agent_position.x, 600]);
  const agent_y = useTransform(world_progress, [0, 0.34], [start_position_y - 720, 360]);
  const agent_scale = useTransform(world_progress, [0, 0.34, 0.43, 0.58, 0.68, 0.82, 0.9, 1], [1, 1, 2, 2.05, 1.35, 1.18, 1, 0.82]);
  const agent_shadow_opacity = useTransform(world_progress, [0, 0.34, 0.44, 0.62, 0.82, 1], [0.12, 0.12, 0.22, 0.18, 0.12, 0.08]);

  const capability_progress = useTransform(world_progress, [0.34, 0.68], [0, 1]);

  const center_land_opacity = useTransform(world_progress, [0.61, 0.66], [0, 1]);
  const inner_land_opacity = useTransform(world_progress, [0.65, 0.72], [0, 1]);
  const middle_land_opacity = useTransform(world_progress, [0.69, 0.78], [0, 1]);
  const outer_land_opacity = useTransform(world_progress, [0.74, 0.85], [0, 1]);
  const continent_opacity = useTransform(world_progress, [0.8, 0.91], [0, 1]);
  const city_boundary_opacity = useTransform(world_progress, [0.77, 0.9], [0, 0.74]);
  const federation_boundary_opacity = useTransform(world_progress, [0.9, 0.98], [0, 1]);
  const federation_boundary_path = useTransform(world_progress, [0.9, 1], [0, 1]);
  const world_camera_scale = useTransform(world_progress, [0, 0.55, 0.66, 0.78, 0.9, 1], [1, 1, 0.96, 0.75, 0.58, 0.5]);

  const capabilities_stage_opacity = useTransform(world_progress, [0.35, 0.43, 0.59, 0.68], [0, 1, 1, 0]);
  const city_stage_opacity = useTransform(world_progress, [0.67, 0.75, 0.88, 0.94], [0, 1, 1, 0]);
  const federation_stage_opacity = useTransform(world_progress, [0.9, 0.98], [0, 1]);
  const seam_field_opacity = useTransform(seam_progress, [0, 0.2, 1], [0, 0.16, 0.5]);
  const seam_line_opacity = useTransform(seam_progress, [0, 0.15, 1], [0, 0.28, 0.9]);
  const seam_line_scale = useTransform(seam_progress, [0, 1], [0.16, 1]);

  const growth_opacities = reduce_motion
    ? [0, 0, 0, 0, 0]
    : [center_land_opacity, inner_land_opacity, middle_land_opacity, outer_land_opacity, continent_opacity];

  return (
    <section ref={section_ref} className={reduce_motion ? "relative min-h-svh overflow-hidden bg-background" : "relative h-[318svh] bg-background"}>
      <div className={reduce_motion ? "relative min-h-svh overflow-hidden" : "sticky top-0 h-svh overflow-hidden"}>
        <div className="absolute inset-0">
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[200svh]"
            style={{ y: reduce_motion ? "0svh" : hero_dom_track_y, willChange: reduce_motion ? undefined : "transform" }}
          >
            <div className="pointer-events-auto absolute inset-x-5 top-[9svh] mx-auto max-w-4xl text-center md:inset-x-8 md:top-[10svh]">
              <h1 className="font-serif text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-none text-foreground">{t("hero.title")}</h1>
              <p className="mx-auto mt-5 max-w-3xl text-[clamp(1.05rem,2vw,1.45rem)] font-medium leading-snug text-foreground">{positioning.hero_headline}</p>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-[1.75] text-text-soft md:text-base">{positioning.hero_description}</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a href="#quickstart" className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("hero.quickStart")}
                  <IconArrowRight className="size-4" strokeWidth={1.7} />
                </a>
                <Link to={learn_more_path} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-background px-5 text-sm font-semibold text-foreground transition-colors duration-150 hover:border-line-strong hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("hero.learnMore")}
                  <IconArrowRight className="size-4" strokeWidth={1.6} />
                </Link>
              </div>
            </div>
          </motion.div>

          <h2 className="sr-only">{t("productWorld.title")}</h2>
          <p className="sr-only">{t("productWorld.description")}</p>

          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <svg
              viewBox="0 0 1200 720"
              preserveAspectRatio="xMidYMax meet"
              overflow="visible"
              className="h-full w-[190vw] max-w-none shrink-0 md:w-full"
              role="img"
              aria-label={`${t("hero.cityStage.label")} ${t("productWorld.description")}`}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  set_preview_inspection(null);
                  set_pinned_inspection(null);
                }
              }}
            >
              <motion.g style={{ y: reduce_motion ? 0 : hero_scene_track_y, willChange: reduce_motion ? undefined : "transform" }}>
                <HomeHeroCityStage locale={locale} city_opacity={1} city_y={0} city_scale={1} />

                <g transform={reduce_motion ? "translate(0 0)" : "translate(0 720)"}>
                  <motion.g className="pointer-events-none" style={{ scale: reduce_motion ? 1 : world_camera_scale, transformOrigin: "600px 360px", willChange: "transform" }}>
                    {!reduce_motion ? (
                      <HomeProductWorldSection
                        agent_accent={home_hero_agent_accent}
                        capability_progress={capability_progress}
                        growth_opacities={growth_opacities}
                        active_cell_key={pinned_inspection?.cell.key ?? preview_inspection?.cell.key ?? null}
                        is_interactive={map_is_interactive}
                        on_cell_preview={(event) => {
                          if (!pinned_inspection) {
                            set_preview_inspection({ ...event, is_pinned: false });
                          }
                        }}
                        on_cell_preview_end={() => {
                          if (!pinned_inspection) set_preview_inspection(null);
                        }}
                        on_cell_select={(event) => {
                          if (pinned_inspection?.cell.key === event.cell.key) {
                            set_pinned_inspection(null);
                            set_preview_inspection(null);
                            return;
                          }
                          const next_inspection = { ...event, is_pinned: true };
                          set_pinned_inspection(next_inspection);
                          set_preview_inspection(next_inspection);
                        }}
                        city_boundary_opacity={city_boundary_opacity}
                        federation_boundary_opacity={federation_boundary_opacity}
                        federation_boundary_path={federation_boundary_path}
                      />
                    ) : null}

                  </motion.g>

                  <HomeHeroAgentActor
                    accent={home_hero_agent_accent}
                    agent_x={reduce_motion ? home_hero_agent_position.x : agent_x}
                    agent_y={reduce_motion ? start_position_y : agent_y}
                    agent_scale={reduce_motion ? 1 : agent_scale}
                    shadow_opacity={reduce_motion ? 0.12 : agent_shadow_opacity}
                    scroll_progress={world_progress}
                    capability_progress={capability_progress}
                    reduce_motion={Boolean(reduce_motion)}
                  />
                </g>
              </motion.g>
            </svg>
          </div>

          {!reduce_motion ? (
            <HomeProductWorldInspector
              inspection={pinned_inspection ?? preview_inspection}
              on_close={() => {
                set_preview_inspection(null);
                set_pinned_inspection(null);
              }}
            />
          ) : null}

          <div className="pointer-events-none absolute inset-x-5 bottom-[4svh] z-20 mx-auto h-10 max-w-5xl text-center md:inset-x-8 md:bottom-[5svh]">
            {!reduce_motion ? <>
              <motion.p style={{ opacity: capabilities_stage_opacity }} className="absolute inset-x-0 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-soft">{t("productWorld.labels.capabilities")}</motion.p>
              <motion.p style={{ opacity: city_stage_opacity }} className="absolute inset-x-0 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-soft">{t("productWorld.labels.city")}</motion.p>
              <motion.p style={{ opacity: federation_stage_opacity }} className="absolute inset-x-0 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-soft">{t("productWorld.labels.federation")}</motion.p>
            </> : null}
          </div>

          {!reduce_motion ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-16 overflow-hidden">
              <motion.div
                className="absolute inset-0"
                style={{
                  opacity: seam_field_opacity,
                  backgroundImage: `linear-gradient(to top, ${home_hero_agent_accent}24, transparent)`,
                }}
              />
              <motion.div
                className="absolute inset-x-0 bottom-0 mx-auto h-px max-w-5xl origin-center"
                style={{
                  opacity: seam_line_opacity,
                  scaleX: seam_line_scale,
                  backgroundColor: home_hero_agent_accent,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default HomeHeroWorldSection;

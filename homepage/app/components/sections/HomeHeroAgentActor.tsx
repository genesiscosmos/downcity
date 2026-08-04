/**
 * Hero 舞台中独立于场景的主角 Ghost 演员层。
 *
 * 页面静止在 Hero 顶部时，内层 Ghost 沿道路水平活动；滚动开始后，
 * 自主位移立即收束到原点，由外层共享滚动坐标完整接管。城市与 Product World 因此
 * 只负责绘制环境，不拥有主角的生命周期。
 */

import { useRef, useState } from "react";
import { motion, useMotionValueEvent } from "framer-motion";
import { HomeGhostGlyph } from "@/components/shared/HomeGhostGlyph";
import type { HomeHeroAgentActorProps } from "@/types/home/HomeGhost";

const idle_progress_threshold = 0.001;
const city_agent_size = 22;

/** 不同居民在道路上的水平活动路径。 */
const agent_idle_x_routes: Record<string, number[]> = {
  blue: [0, 18, 18, 18, 18, -12, -12, -12, 0, 0],
  green: [0, -16, -16, -16, 20, 20, 20, 0, 0, 0],
  rust: [0, 22, 22, 22, 22, -14, -14, 0, 0, 0],
  violet: [0, 16, 16, 16, -18, -18, -18, 0, 0, 0],
  red: [0, -18, -18, -18, 14, 14, 14, 0, 0, 0],
};

const idle_keyframe_times = [0, 0.12, 0.27, 0.36, 0.44, 0.58, 0.68, 0.79, 0.9, 1];
const stationary_idle_route = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** 返回未知 Ghost 的安全静止路径。 */
function get_idle_route(routes: Record<string, number[]>, ghost_key: string) {
  return routes[ghost_key] ?? stationary_idle_route;
}

/** 渲染可在城市生活状态和滚动叙事状态间连续切换的主角。 */
export function HomeHeroAgentActor({
  ghost_key,
  accent,
  agent_x,
  agent_y,
  agent_scale,
  shadow_opacity,
  scroll_progress,
  reduce_motion,
}: HomeHeroAgentActorProps) {
  const [is_city_idle, set_is_city_idle] = useState(true);
  const is_city_idle_ref = useRef(true);

  useMotionValueEvent(scroll_progress, "change", (progress) => {
    const next_is_city_idle = progress <= idle_progress_threshold;
    if (is_city_idle_ref.current === next_is_city_idle) return;
    is_city_idle_ref.current = next_is_city_idle;
    set_is_city_idle(next_is_city_idle);
  });

  const can_roam_city = is_city_idle && !reduce_motion;
  const idle_x_route = get_idle_route(agent_idle_x_routes, ghost_key);

  return (
    <motion.g
      aria-hidden="true"
      data-home-hero-agent-actor=""
      style={{
        x: agent_x,
        y: agent_y,
        scale: agent_scale,
        transformOrigin: "0px 0px",
        willChange: reduce_motion ? undefined : "transform",
      }}
    >
      <motion.g
        data-home-hero-agent-roaming=""
        animate={can_roam_city ? { x: idle_x_route } : { x: 0 }}
        transition={can_roam_city
          ? {
              duration: 13.5,
              ease: "easeInOut",
              repeat: Infinity,
              times: idle_keyframe_times,
            }
          : {
              duration: reduce_motion ? 0 : 0.24,
              ease: [0.16, 1, 0.3, 1],
            }}
      >
        <motion.ellipse
          cx="0"
          cy="15"
          rx="15"
          ry="4"
          fill={accent}
          style={{ opacity: shadow_opacity }}
        />
        <HomeGhostGlyph center_x={0} center_y={0} size={city_agent_size} accent={accent} />
      </motion.g>
    </motion.g>
  );
}

export default HomeHeroAgentActor;

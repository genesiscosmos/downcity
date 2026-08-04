/**
 * Hero 舞台中独立于场景的主角 Ghost 演员层。
 *
 * 页面静止在 Hero 顶部时，内层 Ghost 沿与建筑立面匹配的折线路径活动；滚动开始后，
 * 自主位移立即收束到原点，由外层共享滚动坐标完整接管。城市与 Product World 因此
 * 只负责绘制环境，不拥有主角的生命周期。
 */

import { useRef, useState } from "react";
import { motion, useMotionValueEvent } from "framer-motion";
import { HomeGhostGlyph } from "@/components/shared/HomeGhostGlyph";
import type { HomeHeroAgentActorProps } from "@/types/home/HomeGhost";

const idle_progress_threshold = 0.001;

/** 不同居民与所在建筑匹配的水平活动路径。 */
const agent_idle_x_routes: Record<string, number[]> = {
  blue: [0, 24, 24, 24, 24, 24, -18, -18, 0, 0],
  green: [0, 0, 0, 54, 54, 0, 0, 0, 0, 0],
  rust: [0, 34, 34, 34, 34, -28, -28, 0, 0, 0],
  violet: [0, 34, 34, 34, 34, -16, -16, 0, 0, 0],
  red: [0, -4, -4, -4, -4, -38, -38, 0, 0, 0],
};

/** 不同居民与所在建筑匹配的上下楼活动路径。 */
const agent_idle_y_routes: Record<string, number[]> = {
  blue: [0, 0, -54, -74, -74, -74, 0, 0, 0, 0],
  green: [0, 46, 118, 118, 118, 118, 46, 0, 0, 0],
  rust: [0, 0, -30, -30, -30, 0, 0, 0, 0, 0],
  violet: [0, 0, -34, -54, -54, 0, 0, 0, 0, 0],
  red: [0, 0, -44, -68, -68, 0, 0, 0, 0, 0],
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
  const idle_y_route = get_idle_route(agent_idle_y_routes, ghost_key);

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
        animate={can_roam_city ? { x: idle_x_route, y: idle_y_route } : { x: 0, y: 0 }}
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
          rx="18"
          ry="5"
          fill={accent}
          style={{ opacity: shadow_opacity }}
        />
        <HomeGhostGlyph center_x={0} center_y={0} size={28} accent={accent} />
      </motion.g>
    </motion.g>
  );
}

export default HomeHeroAgentActor;

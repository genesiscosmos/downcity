/**
 * Hero 舞台中独立于场景的主角 Ghost 演员层。
 *
 * 页面静止在 Hero 顶部时，内层 Ghost 沿道路水平活动；滚动开始后，
 * 自主位移立即收束到原点，由外层共享滚动坐标完整接管。城市与 Product World 因此
 * 只负责绘制环境，不拥有主角的生命周期。
 */

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import { HomeGhostGlyph } from "@/components/shared/HomeGhostGlyph";
import type { HomeHeroAgentActorProps } from "@/types/home/HomeGhost";

const idle_progress_threshold = 0.001;
const city_agent_size = 22;

/** 主角在城市道路上的固定生活轨迹。 */
const agent_idle_x_route = [0, 160, 160, 160, -100, -100, -100, 0, 0];
const idle_keyframe_times = [0, 0.2, 0.28, 0.34, 0.64, 0.72, 0.78, 0.94, 1];

/** 渲染可在城市生活状态和滚动叙事状态间连续切换的主角。 */
export function HomeHeroAgentActor({
  accent,
  agent_x,
  agent_y,
  agent_scale,
  shadow_opacity,
  scroll_progress,
  capability_progress,
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
  const reaction_x = useTransform(capability_progress, (progress) => {
    if (reduce_motion || progress < 0.12 || progress > 0.84) return 0;
    const reaction_progress = (progress - 0.12) / 0.72;
    const envelope = Math.sin(reaction_progress * Math.PI) * (0.8 + reaction_progress * 2.8);
    return Math.sin(reaction_progress * Math.PI * 22) * envelope;
  });
  const reaction_y = useTransform(capability_progress, (progress) => {
    if (reduce_motion || progress < 0.12 || progress > 0.84) return 0;
    const reaction_progress = (progress - 0.12) / 0.72;
    const envelope = Math.sin(reaction_progress * Math.PI) * (0.5 + reaction_progress * 1.7);
    return Math.cos(reaction_progress * Math.PI * 20) * envelope;
  });
  const reaction_rotate = useTransform(capability_progress, (progress) => {
    if (reduce_motion || progress < 0.28 || progress > 0.84) return 0;
    const reaction_progress = (progress - 0.28) / 0.56;
    return Math.sin(reaction_progress * Math.PI * 12) * Math.sin(reaction_progress * Math.PI) * 2.2;
  });
  const reaction_scale_x = useTransform(capability_progress, [0, 0.32, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.88, 0.94, 1], [1, 1, 0.96, 1.055, 0.95, 1.06, 0.93, 1.045, 0.8, 1.09, 1]);
  const reaction_scale_y = useTransform(capability_progress, [0, 0.32, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.88, 0.94, 1], [1, 1, 1.045, 0.96, 1.06, 0.95, 1.07, 0.96, 0.84, 1.06, 1]);
  const energy_opacity = useTransform(capability_progress, [0.16, 0.46, 0.76, 0.86, 0.95, 1], [0, 0.05, 0.18, 0.5, 0.1, 0]);
  const energy_scale = useTransform(capability_progress, [0.16, 0.76, 0.88, 1], [0.7, 0.92, 1.18, 1.42]);

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
        animate={can_roam_city ? { x: agent_idle_x_route } : { x: 0 }}
        transition={can_roam_city
          ? {
              duration: 16,
              ease: "easeInOut",
              repeat: Infinity,
              times: idle_keyframe_times,
            }
          : {
              duration: reduce_motion ? 0 : 0.24,
              ease: [0.16, 1, 0.3, 1],
            }}
      >
        <motion.g
          style={{
            x: reaction_x,
            y: reaction_y,
            rotate: reaction_rotate,
            scaleX: reduce_motion ? 1 : reaction_scale_x,
            scaleY: reduce_motion ? 1 : reaction_scale_y,
            transformOrigin: "0px 0px",
            willChange: reduce_motion ? undefined : "transform",
          }}
        >
          <motion.ellipse cx="0" cy="15" rx="15" ry="4" fill={accent} style={{ opacity: shadow_opacity }} />
          <motion.circle cx="0" cy="0" r="19" fill={accent} style={{ opacity: energy_opacity, scale: energy_scale, transformOrigin: "0px 0px" }} />
          <HomeGhostGlyph center_x={0} center_y={0} size={city_agent_size} accent={accent} />
        </motion.g>
      </motion.g>
    </motion.g>
  );
}

export default HomeHeroAgentActor;

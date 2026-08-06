/**
 * Product World 的纯展示标注层。
 *
 * 标注不持有交互状态且完全忽略指针事件，避免挡住下方关键地块；文字使用背景色
 * 描边，在远景和不同地形色上仍保持可读。
 */

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { home_product_world_origin } from "@/lib/home-product-world-layout";
import { home_world_hex_center } from "@/lib/home-world-geometry";
import type { HomeProductWorldAnnotationLayerProps } from "@/types/home/HomeProductWorld";

/** 绘制 Federation、City 与命名地貌标注。 */
export function HomeProductWorldAnnotationLayer({ annotations, opacity }: HomeProductWorldAnnotationLayerProps) {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");

  return (
    <motion.g aria-hidden="true" className="pointer-events-none" style={{ opacity }}>
      {annotations.map((annotation) => {
        const center = home_world_hex_center(home_product_world_origin.x, home_product_world_origin.y, home_product_world_origin.radius, annotation.q, annotation.row);
        const is_federation = annotation.kind === "federation";
        const is_feature = annotation.kind === "feature";
        return (
          <g key={annotation.key} transform={`translate(${center.x} ${center.y})`}>
            {is_feature ? <><circle r="3.5" className="fill-foreground" fillOpacity="0.58" /><path d="M0 0 L11 -10" className="fill-none stroke-foreground" strokeOpacity="0.38" strokeWidth="1" /></> : null}
            <text
              x={is_feature ? 14 : 0}
              y={is_feature ? -12 : 0}
              textAnchor={is_feature ? "start" : "middle"}
              dominantBaseline="middle"
              className={is_federation ? "fill-foreground stroke-background text-[22px] font-semibold uppercase tracking-[0.2em]" : annotation.kind === "city" ? "fill-foreground stroke-background text-[15px] font-semibold tracking-[0.08em]" : "fill-text-soft stroke-background text-[15px] font-medium italic tracking-[0.04em]"}
              strokeWidth={is_federation ? 7 : 5}
              strokeOpacity="0.92"
              style={{ paintOrder: "stroke" }}
            >
              {t(`productWorld.map.${annotation.label_key}`)}
            </text>
          </g>
        );
      })}
    </motion.g>
  );
}

export default HomeProductWorldAnnotationLayer;

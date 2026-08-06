/**
 * Product World 的固定 HTML 地点信息卡。
 *
 * 信息卡独立于 SVG 镜头缩放，Hover 预览不接管指针；只有点击固定后才提供关闭
 * 操作。这样地图上只保留少量关键命中区域，不会为每个地块创建昂贵弹层。
 */

import { AnimatePresence, motion } from "framer-motion";
import { IconX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import type { HomeProductWorldInspectorProps } from "@/types/home/HomeProductWorld";

/** 显示当前预览或固定的关键地点。 */
export function HomeProductWorldInspector({ inspection, on_close }: HomeProductWorldInspectorProps) {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const cell = inspection?.cell;
  const title = cell
    ? cell.feature_key
      ? t(`productWorld.map.annotations.${cell.feature_key}`)
      : t(`productWorld.map.content.${cell.content}.title`)
    : "";
  const description = cell
    ? cell.feature_key
      ? t(`productWorld.map.features.${cell.feature_key}`)
      : t(`productWorld.map.content.${cell.content}.description`)
    : "";
  const city_label = cell?.city_type ? t(`productWorld.map.cityTypes.${cell.city_type}`) : null;
  const federation_label = cell?.federation ? t(`productWorld.map.federations.${cell.federation}`) : null;

  return (
    <AnimatePresence>
      {inspection ? (
        <motion.aside
          key={`${inspection.cell.key}-${inspection.is_pinned ? "pinned" : "preview"}`}
          aria-live="polite"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className={`fixed z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-background/92 p-4 shadow-xl shadow-foreground/10 backdrop-blur-xl ${inspection.is_pinned ? "pointer-events-auto" : "pointer-events-none"}`}
          style={{
            left: `clamp(1rem, calc(${inspection.client_x}px + 1rem), calc(100vw - 23rem))`,
            top: `clamp(1rem, calc(${inspection.client_y}px + 1rem), calc(100vh - 15rem))`,
          }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-text-subtle">{t(`productWorld.map.content.${cell?.content ?? "empty"}.title`)}</p>
              <h3 className="mt-1 font-serif text-xl font-semibold leading-tight text-foreground">{title}</h3>
            </div>
            {inspection.is_pinned ? (
              <button type="button" aria-label={t("productWorld.map.close")} onClick={on_close} className="pointer-events-auto inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-text-soft transition-colors duration-150 hover:border-line-strong hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <IconX className="size-4" strokeWidth={1.7} />
              </button>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-text-soft">{description}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[0.68rem] font-medium text-text-subtle">
            {federation_label ? <span className="rounded-full border border-line bg-surface-soft px-2.5 py-1">{federation_label}</span> : null}
            {city_label ? <span className="rounded-full border border-line bg-surface-soft px-2.5 py-1">{city_label}</span> : null}
            <span className="rounded-full border border-line bg-surface-soft px-2.5 py-1">q {cell?.q} · r {cell?.row}</span>
          </div>
          <p className="mt-3 text-[0.65rem] text-text-subtle">{t(inspection.is_pinned ? "productWorld.map.pinnedHint" : "productWorld.map.previewHint")}</p>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

export default HomeProductWorldInspector;

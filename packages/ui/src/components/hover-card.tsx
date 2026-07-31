"use client";
/** Vibecape 风格 HoverCard 悬停信息卡片组件组。 */
import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import { cn } from "../lib/utils";
import { use_theme_portal_container } from "./theme-container";
const HoverCard = ({ delay = 180, ...props }: Primitive.Root.Props & { delay?: number }) => <Primitive.Provider delay={delay}><Primitive.Root {...props} /></Primitive.Provider>;
const HoverCardTrigger = (props: Primitive.Trigger.Props) => <Primitive.Trigger data-slot="hover-card-trigger" {...props} />;
const HoverCardContent = ({ className, side = "bottom", sideOffset = 6, align = "center", ...props }: Primitive.Popup.Props & Pick<Primitive.Positioner.Props, "align" | "side" | "sideOffset">) => {
  const theme_container = use_theme_portal_container();
  return <Primitive.Portal container={theme_container}><Primitive.Positioner align={align} side={side} sideOffset={sideOffset} className="z-50 outline-none"><Primitive.Popup className={cn("w-72 rounded-xl border border-divider bg-floating-surface p-3 text-sm text-floating-foreground data-ending-style:opacity-0 data-starting-style:opacity-0", className)} {...props} /></Primitive.Positioner></Primitive.Portal>;
};
export { HoverCard, HoverCardContent, HoverCardTrigger };

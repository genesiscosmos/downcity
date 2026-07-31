"use client";
/** Vibecape 风格 HoverCard 悬停信息卡片组件组。 */
import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import { cn } from "../lib/utils";
const HoverCard = ({ delay = 180, ...props }: Primitive.Root.Props & { delay?: number }) => <Primitive.Provider delay={delay}><Primitive.Root {...props} /></Primitive.Provider>;
const HoverCardTrigger = Primitive.Trigger;
const HoverCardContent = ({ className, side = "bottom", sideOffset = 6, align = "center", ...props }: Primitive.Popup.Props & Pick<Primitive.Positioner.Props, "align" | "side" | "sideOffset">) => <Primitive.Portal><Primitive.Positioner align={align} side={side} sideOffset={sideOffset} className="z-50 outline-none"><Primitive.Popup className={cn("w-72 rounded-xl border border-divider bg-surface-subtle p-3 text-sm text-foreground shadow-sm data-ending-style:opacity-0 data-starting-style:opacity-0", className)} {...props} /></Primitive.Positioner></Primitive.Portal>;
export { HoverCard, HoverCardContent, HoverCardTrigger };

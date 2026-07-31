"use client";
/** Vibecape 风格 ScrollArea 组件组。 */
import { ScrollArea as Primitive } from "@base-ui/react/scroll-area";
import { cn } from "../lib/utils";
const ScrollArea = Primitive.Root;
const ScrollAreaViewport = ({ className, ...props }: Primitive.Viewport.Props) => <Primitive.Viewport className={cn("size-full", className)} {...props} />;
const ScrollAreaContent = ({ className, ...props }: Primitive.Content.Props) => <Primitive.Content className={cn("min-w-full", className)} {...props} />;
const ScrollAreaScrollbar = ({ className, ...props }: Primitive.Scrollbar.Props) => <Primitive.Scrollbar className={cn("flex touch-none select-none bg-transparent p-px data-[orientation=vertical]:w-1.5 data-[orientation=horizontal]:h-1.5", className)} {...props}><Primitive.Thumb className="flex-1 rounded-full bg-muted-foreground/15 hover:bg-muted-foreground/35" /></Primitive.Scrollbar>;
export { ScrollArea, ScrollAreaContent, ScrollAreaScrollbar, ScrollAreaViewport };

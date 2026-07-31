"use client";
/** Vibecape 风格可调节面板组件组。 */
import { GripVerticalIcon } from "lucide-react";
import * as Primitive from "react-resizable-panels";
import { cn } from "../lib/utils";
const ResizablePanelGroup = ({ className, ...props }: Primitive.GroupProps) => <Primitive.Group className={cn("flex h-full w-full data-[orientation=vertical]:flex-col", className)} {...props} />;
const ResizablePanel = (props: Primitive.PanelProps) => <Primitive.Panel {...props} />;
const ResizableHandle = ({ className, withHandle = false, ...props }: Primitive.SeparatorProps & { withHandle?: boolean }) => <Primitive.Separator className={cn("relative flex w-px items-center justify-center bg-divider outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 focus-visible:bg-ring data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=horizontal]:after:inset-x-0 data-[orientation=horizontal]:after:h-2 data-[orientation=horizontal]:after:w-auto data-[orientation=horizontal]:after:translate-x-0", className)} {...props}>{withHandle ? <span className="relative z-10 flex size-5 items-center justify-center rounded bg-surface-emphasis text-muted-foreground"><GripVerticalIcon className="size-3" /></span> : null}</Primitive.Separator>;
export { ResizableHandle, ResizablePanel, ResizablePanelGroup };

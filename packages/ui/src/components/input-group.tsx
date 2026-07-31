/** Vibecape 风格 InputGroup 输入组合组件组。 */
import type * as React from "react";
import { cn } from "../lib/utils";
const InputGroup = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("flex min-h-9 items-center rounded-lg bg-control-surface text-foreground transition-colors hover:bg-control-hover focus-within:bg-control-hover", className)} {...props} />;
const InputGroupAddon = ({ className, align = "inline-start", ...props }: React.ComponentProps<"div"> & { align?: "inline-start" | "inline-end" }) => <div data-align={align} className={cn("flex shrink-0 items-center gap-1 px-2 text-muted-foreground data-[align=inline-end]:order-last", className)} {...props} />;
const InputGroupInput = ({ className, ...props }: React.ComponentProps<"input">) => <input className={cn("h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/50", className)} {...props} />;
const InputGroupTextarea = ({ className, ...props }: React.ComponentProps<"textarea">) => <textarea className={cn("min-h-20 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50", className)} {...props} />;
export { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea };

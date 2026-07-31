"use client";
/** Vibecape 风格 Combobox 可搜索选择组件组。 */
import { Combobox as Primitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { cn } from "../lib/utils";
const Combobox = Primitive.Root;
const ComboboxInput = ({ className, ...props }: Primitive.Input.Props) => <Primitive.Input className={cn("h-8 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/50", className)} {...props} />;
const ComboboxInputGroup = ({ className, ...props }: Primitive.InputGroup.Props) => <Primitive.InputGroup className={cn("flex min-h-8 items-center rounded-lg bg-control-surface text-foreground transition-colors hover:bg-control-hover focus-within:bg-control-hover", className)} {...props} />;
const ComboboxTrigger = ({ className, ...props }: Primitive.Trigger.Props) => <Primitive.Trigger aria-label="Open options" className={cn("flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground", className)} {...props}><ChevronDownIcon className="size-3.5" /></Primitive.Trigger>;
const ComboboxClear = ({ className, ...props }: Primitive.Clear.Props) => <Primitive.Clear aria-label="Clear selection" className={cn("flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground", className)} {...props}><XIcon className="size-3.5" /></Primitive.Clear>;
const ComboboxContent = ({ className, children, ...props }: Primitive.Popup.Props) => <Primitive.Portal><Primitive.Positioner sideOffset={4} className="z-50 outline-none"><Primitive.Popup className={cn("w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-hidden rounded-floating-surface border border-border bg-background py-1 text-foreground shadow-lg data-ending-style:opacity-0 data-starting-style:opacity-0", className)} {...props}>{children}</Primitive.Popup></Primitive.Positioner></Primitive.Portal>;
const ComboboxList = ({ className, ...props }: Primitive.List.Props) => <Primitive.List className={cn("max-h-64 overflow-y-auto outline-none", className)} {...props} />;
const ComboboxItem = ({ className, children, ...props }: Primitive.Item.Props) => <Primitive.Item className={cn("grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-floating-item px-2 py-1.5 text-xs outline-none data-highlighted:bg-interaction-hover data-selected:bg-interaction-selected data-disabled:opacity-50", className)} {...props}><Primitive.ItemIndicator><CheckIcon className="size-3.5" /></Primitive.ItemIndicator><span className="truncate">{children}</span></Primitive.Item>;
const ComboboxEmpty = ({ className, ...props }: Primitive.Empty.Props) => <Primitive.Empty className={cn("px-2 py-4 text-xs text-muted-foreground", className)} {...props} />;
export { Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxTrigger };

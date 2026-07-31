"use client";
/** Vibecape 风格 Accordion 组件组。 */
import { Accordion as Primitive } from "@base-ui/react/accordion";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../lib/utils";
const Accordion = Primitive.Root;
const AccordionItem = ({ className, ...props }: Primitive.Item.Props) => <Primitive.Item className={cn("border-b border-divider", className)} {...props} />;
const AccordionTrigger = ({ className, children, ...props }: Primitive.Trigger.Props) => <Primitive.Header><Primitive.Trigger className={cn("flex min-h-10 w-full items-center justify-between gap-3 px-2 text-left text-sm text-foreground hover:bg-interaction-hover", className)} {...props}>{children}<ChevronDownIcon className="size-3.5 shrink-0 transition-transform data-[panel-open]:rotate-180" /></Primitive.Trigger></Primitive.Header>;
const AccordionContent = ({ className, ...props }: Primitive.Panel.Props) => <Primitive.Panel className={cn("overflow-hidden text-sm text-muted-foreground data-ending-style:opacity-0 data-starting-style:opacity-0", className)} {...props} />;
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };

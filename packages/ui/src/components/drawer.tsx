"use client";
/** Vibecape 风格 Drawer 移动端抽屉组件组。 */
import type * as React from "react";
import { Drawer as Primitive } from "@base-ui/react/drawer";
import { cn } from "../lib/utils";
const Drawer = Primitive.Root;
const DrawerTrigger = Primitive.Trigger;
const DrawerClose = Primitive.Close;
const DrawerContent = ({ className, ...props }: Primitive.Popup.Props) => <Primitive.Portal><Primitive.Backdrop className="fixed inset-0 z-50 bg-black/80 data-ending-style:opacity-0 data-starting-style:opacity-0" /><Primitive.Viewport className="fixed inset-0 z-50 flex items-end"><Primitive.Popup className={cn("w-full rounded-t-2xl border border-border-subtle bg-background p-4 text-sm text-foreground shadow-xl", className)} {...props} /></Primitive.Viewport></Primitive.Portal>;
const DrawerHeader = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("flex flex-col gap-1 pb-4", className)} {...props} />;
const DrawerFooter = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("flex items-center justify-end gap-2 pt-4", className)} {...props} />;
const DrawerTitle = ({ className, ...props }: Primitive.Title.Props) => <Primitive.Title className={cn("text-base font-medium", className)} {...props} />;
const DrawerDescription = ({ className, ...props }: Primitive.Description.Props) => <Primitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger };

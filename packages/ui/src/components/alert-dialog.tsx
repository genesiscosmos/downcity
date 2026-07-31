"use client";
/** Vibecape 风格 AlertDialog 确认对话框组件组。 */
import type * as React from "react";
import { AlertDialog as Primitive } from "@base-ui/react/alert-dialog";
import { cn } from "../lib/utils";
const AlertDialog = Primitive.Root;
const AlertDialogTrigger = Primitive.Trigger;
const AlertDialogClose = Primitive.Close;
const AlertDialogContent = ({ className, ...props }: Primitive.Popup.Props) => <Primitive.Portal><Primitive.Backdrop className="fixed inset-0 z-50 bg-black/80 data-ending-style:opacity-0 data-starting-style:opacity-0" /><Primitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4"><Primitive.Popup className={cn("w-full max-w-md rounded-2xl border border-border-subtle bg-background p-4 text-sm text-foreground shadow-xl data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:scale-95 data-starting-style:scale-95", className)} {...props} /></Primitive.Viewport></Primitive.Portal>;
const AlertDialogHeader = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("flex flex-col gap-1", className)} {...props} />;
const AlertDialogFooter = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("mt-4 flex items-center justify-end gap-2", className)} {...props} />;
const AlertDialogTitle = ({ className, ...props }: Primitive.Title.Props) => <Primitive.Title className={cn("text-base font-medium", className)} {...props} />;
const AlertDialogDescription = ({ className, ...props }: Primitive.Description.Props) => <Primitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
export { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger };

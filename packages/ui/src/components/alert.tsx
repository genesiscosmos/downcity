/** Vibecape 风格 Alert 提示组件组。 */
import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
const alert_variants = cva("relative flex w-full gap-2 rounded-xl px-3 py-2.5 text-sm", { variants: { variant: { default: "bg-surface-subtle text-foreground", destructive: "bg-destructive/10 text-destructive" } }, defaultVariants: { variant: "default" } });
const Alert = ({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alert_variants>) => <div role="alert" className={cn(alert_variants({ variant }), className)} {...props} />;
const AlertTitle = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("font-medium leading-5", className)} {...props} />;
const AlertDescription = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("text-xs leading-5 text-muted-foreground", className)} {...props} />;
export { Alert, AlertDescription, AlertTitle };

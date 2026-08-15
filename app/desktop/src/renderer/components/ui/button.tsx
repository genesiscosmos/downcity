/** Duobox Renderer 的标准按钮基础组件。 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button_variants = cva(
  "inline-flex flex-none items-center justify-center whitespace-nowrap rounded-md border-none bg-transparent text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground data-[state=open]:bg-interaction-selected data-[state=open]:text-foreground data-[state=open]:hover:bg-interaction-active focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary/90 text-primary-foreground/80 hover:bg-primary hover:text-primary-foreground data-[state=open]:bg-primary data-[state=open]:text-primary-foreground [&_svg]:text-primary-foreground",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive data-[state=open]:bg-destructive/20 data-[state=open]:text-destructive",
        default: "",
      },
      size: {
        default: "h-6 w-auto min-w-0 gap-1 px-1.5 text-[11px] leading-4 [&_svg]:size-3.5",
        icon: "size-6 shrink-0 p-0 [&_svg]:size-3.5",
        full: "h-6 w-full justify-start gap-1 px-1.5 text-[11px] leading-4 [&_svg]:size-3.5",
        sidebar: "h-8 w-full justify-start gap-2 rounded-lg px-2 text-xs [&_svg]:size-4",
        large: "h-14 w-full gap-2 px-5 text-sm font-medium leading-4 [&_svg]:size-4",
      },
      actived: {
        true: "bg-interaction-selected text-foreground hover:bg-interaction-active",
        false: "",
      },
    },
    defaultVariants: { variant: "default", size: "default", actived: false },
  },
);

/** Duobox Button 对外属性。 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button_variants> {
  /** 是否以激活状态显示。 */
  actived?: boolean;
}

/** 与 Duobox 完全相同尺寸和状态的按钮。 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type, actived, ...props }, ref) => (
    <button type={type || "button"} className={cn(button_variants({ variant, size, className, actived }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

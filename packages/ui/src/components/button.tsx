/**
 * Downcity Button 基础组件。
 *
 * 关键说明（中文）
 * - 默认采用 Downcity Console 的紧凑交互风格。
 * - 通过 `variant` 与 `size` 控制视觉与尺寸，不承载业务语义。
 */

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex flex-none items-center justify-center whitespace-nowrap rounded-md border-none bg-transparent text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground data-[popup-open]:bg-interaction-selected data-[popup-open]:text-foreground data-[state=open]:bg-interaction-selected data-[state=open]:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "",
        outline:
          "",
        secondary:
          "",
        ghost:
          "",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-6 min-w-0 gap-1 px-1.5 text-[11px] leading-4 [&_svg]:size-3.5",
        xs: "h-6 gap-1 px-1.5 text-[11px] leading-4 [&_svg]:size-3",
        sm: "h-6 gap-1 px-1.5 text-[11px] leading-4 [&_svg]:size-3.5",
        lg: "h-14 w-full gap-2 px-5 text-sm font-medium leading-4 [&_svg]:size-4",
        icon: "size-6 shrink-0 p-0 [&_svg]:size-3.5",
        "icon-xs": "size-6 shrink-0 p-0 [&_svg]:size-3",
        "icon-sm": "size-6 shrink-0 p-0 [&_svg]:size-3.5",
        "icon-lg": "size-6 shrink-0 p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

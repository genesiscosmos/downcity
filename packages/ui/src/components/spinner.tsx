/**
 * Downcity Spinner 加载指示器。
 *
 * 关键说明（中文）
 * - 仅表达进行中的异步状态，不维护任务生命周期。
 * - 默认继承当前文本颜色，便于在按钮、菜单和空状态中组合。
 */

import { LoaderCircleIcon } from "lucide-react";

import type { DowncitySpinnerProps, DowncitySpinnerSize } from "../types/components";
import { cn } from "../lib/utils";

const spinner_size_class_names: Record<DowncitySpinnerSize, string> = {
  sm: "size-3.5",
  default: "size-4",
  lg: "size-5",
};

function Spinner({
  className,
  size = "default",
  ...props
}: DowncitySpinnerProps) {
  return (
    <LoaderCircleIcon
      data-slot="spinner"
      aria-hidden="true"
      className={cn("animate-spin", spinner_size_class_names[size], className)}
      {...props}
    />
  );
}

export { Spinner };

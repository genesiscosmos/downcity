"use client";

/**
 * Downcity Toaster 组件。
 *
 * 关键说明（中文）
 * - 提供统一的通知图标、边框圆角和色板映射。
 * - 颜色与明暗模式统一继承 ThemeContainer，不暴露独立主题参数。
 */

import type { CSSProperties } from "react";
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner } from "sonner";

import type { DowncityToasterProps } from "../types/components";

function Toaster({ theme: _legacy_theme, ...props }: DowncityToasterProps) {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface-subtle)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--divider)",
          "--border-radius": "var(--radius-xl)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !rounded-xl !border !border-divider !bg-surface-subtle !shadow-none",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };

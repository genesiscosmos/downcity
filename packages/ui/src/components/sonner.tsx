"use client";

/**
 * Downcity Toaster 组件。
 *
 * 关键说明（中文）
 * - 提供统一的通知图标、边框圆角和色板映射。
 * - 主题模式由宿主显式传入，避免绑定特定主题库实现。
 */

import type { CSSProperties } from "react";
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster({ ...props }: ToasterProps) {
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

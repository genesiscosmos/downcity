"use client";

/**
 * Downcity ImagePreview 纯 UI 图片全屏预览。
 *
 * 关键说明（中文）
 * - 只处理受控开关、Escape 与遮罩关闭。
 * - 图片来源由宿主通过 src 提供，不访问文件系统或应用桥接能力。
 */

import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../lib/utils";
import type { DowncityImagePreviewProps } from "../types/components";

function ImagePreview({ open, onOpenChange, src, alt = "", className }: DowncityImagePreviewProps) {
  const [mounted, set_mounted] = useState(false);

  useEffect(() => {
    set_mounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handle_key_down);
    return () => document.removeEventListener("keydown", handle_key_down);
  }, [onOpenChange, open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-[9999] flex items-center justify-center", className)} role="dialog" aria-modal="true" aria-label={alt || "Image preview"}>
      <button type="button" aria-label="Close image preview" className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <button type="button" aria-label="Close" className="absolute top-4 right-4 z-10 p-2 text-white/60 transition-colors hover:text-white" onClick={() => onOpenChange(false)}><XIcon className="size-5" /></button>
      <img src={src} alt={alt} draggable={false} className="relative z-10 max-h-[90vh] max-w-[90vw] select-none object-contain" />
    </div>,
    document.body,
  );
}

export { ImagePreview };

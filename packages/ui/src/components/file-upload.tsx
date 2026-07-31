"use client";

/**
 * Downcity FileUpload 纯 UI 组件。
 *
 * 文件生命周期完全归宿主所有；本组件只接收浏览器 File 并通知新的受控列表。
 */

import { UploadIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "../lib/utils";
import type { DowncityFileUploadProps } from "../types/components";

function FileUpload({ files = [], onFilesChange, accept, multiple = true, disabled = false, maxFiles, label = "Drop files here", description = "or click to browse", className }: DowncityFileUploadProps) {
  const input_ref = useRef<HTMLInputElement>(null);
  const [is_dragging, set_is_dragging] = useState(false);

  function add_files(incoming_files: FileList | readonly File[]) {
    const available_slots = maxFiles === undefined ? undefined : Math.max(0, maxFiles - files.length);
    const next_files = [...files, ...Array.from(incoming_files).slice(0, available_slots)];
    onFilesChange(multiple ? next_files : next_files.slice(-1));
  }

  return <div className={cn("flex flex-col gap-2", className)}><button type="button" disabled={disabled} onClick={() => input_ref.current?.click()} onDragEnter={(event) => { event.preventDefault(); set_is_dragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => set_is_dragging(false)} onDrop={(event) => { event.preventDefault(); set_is_dragging(false); if (!disabled) add_files(event.dataTransfer.files); }} className={cn("flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-divider bg-surface-subtle px-4 text-center transition-colors hover:bg-interaction-hover disabled:cursor-not-allowed disabled:opacity-50", is_dragging && "border-primary bg-interaction-selected")}><UploadIcon className="size-4 text-muted-foreground" /><span className="text-sm text-foreground">{label}</span><span className="text-xs text-muted-foreground">{description}</span></button><input ref={input_ref} className="sr-only" type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={(event) => { if (event.target.files) add_files(event.target.files); event.target.value = ""; }} />{files.length > 0 ? <ul className="flex flex-col gap-1">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-md bg-surface-emphasis px-2 py-1.5 text-xs"><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="shrink-0 text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => onFilesChange(files.filter((_, file_index) => file_index !== index))} className="rounded p-0.5 text-muted-foreground hover:bg-interaction-hover hover:text-foreground"><XIcon className="size-3" /></button></li>)}</ul> : null}</div>;
}

export { FileUpload };

/**
 * Button 图标按钮示例。
 *
 * 图标按钮不写 `w-* h-*`，统一使用 `icon-*` 尺寸，避免尺寸与图标比例失控。
 */
import { Button } from "@downcity/ui";
import { SettingsIcon, TrashIcon } from "lucide-react";

export default function ButtonIconPreview() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-sm" variant="ghost" aria-label="Open settings">
        <SettingsIcon />
      </Button>
      <Button size="icon" variant="outline" aria-label="Open settings">
        <SettingsIcon />
      </Button>
      <Button size="icon" variant="destructive" aria-label="Delete">
        <TrashIcon />
      </Button>
    </div>
  );
}

/**
 * Toggle 与 ToggleGroup 示例。
 */
import { Toggle, ToggleGroup, ToggleGroupItem } from "@downcity/ui";
import { BoldIcon, ItalicIcon, UnderlineIcon } from "lucide-react";

export default function TogglePreview() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Toggle aria-label="Toggle bold">
        <BoldIcon />
      </Toggle>
      <ToggleGroup defaultValue={["bold"]}>
        <ToggleGroupItem value="bold" aria-label="Bold">
          <BoldIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Italic">
          <ItalicIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="underline" aria-label="Underline">
          <UnderlineIcon />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

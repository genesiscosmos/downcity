/**
 * Checkbox 与 Label 示例。
 */
import { Checkbox, Label } from "@downcity/ui";

export default function CheckboxPreview() {
  return (
    <div className="grid gap-3">
      <Label className="flex items-center gap-2">
        <Checkbox defaultChecked />
        Allow file writes
      </Label>
      <Label className="flex items-center gap-2">
        <Checkbox />
        Require approval for shell commands
      </Label>
      <Label className="flex items-center gap-2 text-muted-foreground">
        <Checkbox disabled />
        Disabled option
      </Label>
    </div>
  );
}

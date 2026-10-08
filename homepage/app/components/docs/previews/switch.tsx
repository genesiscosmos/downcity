/**
 * Switch 示例。
 */
import { Label, Switch } from "@downcity/ui";

export default function SwitchPreview() {
  return (
    <div className="grid gap-3">
      <Label className="flex items-center gap-2">
        <Switch defaultChecked />
        Streaming responses
      </Label>
      <Label className="flex items-center gap-2">
        <Switch />
        Extended thinking
      </Label>
    </div>
  );
}

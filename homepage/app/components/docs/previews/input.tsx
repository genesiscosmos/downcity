/**
 * Input 示例。
 */
import { Input } from "@downcity/ui";

export default function InputPreview() {
  return (
    <div className="grid w-full max-w-sm gap-3">
      <Input placeholder="Agent id" />
      <Input defaultValue="repo-helper" />
      <Input disabled placeholder="Disabled" />
    </div>
  );
}

/**
 * Select 示例。
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@downcity/ui";

export default function SelectPreview() {
  return (
    <div className="w-full max-w-xs">
      <Select defaultValue="deepseek-chat">
        <SelectTrigger>
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="deepseek-chat">deepseek-chat</SelectItem>
          <SelectItem value="deepseek-reasoner">deepseek-reasoner</SelectItem>
          <SelectItem value="gpt-5">gpt-5</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Button 基础示例。
 *
 * 该文件同时是预览渲染源与文档展示的源码，展示的代码就是运行的代码。
 */
import { Button } from "@downcity/ui";

export default function ButtonBasicPreview() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Save</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="ghost">Later</Button>
    </div>
  );
}

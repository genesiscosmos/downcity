/**
 * Tabs 示例。
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@downcity/ui";

export default function TabsPreview() {
  return (
    <Tabs defaultValue="overview" className="w-full max-w-md">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="limits">Limits</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <p className="pt-3">The session owns its model, context, and tool state.</p>
      </TabsContent>
      <TabsContent value="usage">
        <p className="pt-3">Usage is metered per turn and billed from credits.</p>
      </TabsContent>
      <TabsContent value="limits">
        <p className="pt-3">Tool calls stop at the configured approval boundary.</p>
      </TabsContent>
    </Tabs>
  );
}

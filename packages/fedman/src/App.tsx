/** Fedman React 应用组合根。 */

import { useState } from "react";
import { Layout } from "./components/Layout.js";
import { find_fedman_page } from "./config/pages.js";
import { use_remote_data } from "./hooks/use_remote_data.js";
import { request_json } from "./lib/api.js";
import { ActivityPage, ConsumptionPage, OverviewPage, QualityPage, RetentionPage } from "./pages/AnalyticsPages.js";
import { DebuggerPage } from "./pages/DebuggerPage.js";
import { ResourcePage } from "./pages/ResourcePage.js";
import { UsageUsersPage } from "./pages/UsageUsersPage.js";
import type { FederationContext } from "./types/api.js";
import type { AnalyticsRange, FedmanPageId } from "./types/navigation.js";
import type { PageContentProps, ResourcePageId } from "./types/ui.js";

/** Fedman 应用入口。 */
export function App() {
  const [page_id, set_page_id] = useState<FedmanPageId>("overview");
  const [range, set_range] = useState<AnalyticsRange>("30d");
  const [refresh_key, set_refresh_key] = useState(0);
  const page = find_fedman_page(page_id);
  const context_state = use_remote_data(async () => await request_json<FederationContext>("/api/context"), [refresh_key]);

  return (
    <Layout page={page} range={range} context_state={context_state} on_page_change={set_page_id} on_range_change={set_range} on_refresh={() => set_refresh_key((value) => value + 1)}>
      <PageContent page_id={page_id} range={range} refresh_key={refresh_key} />
    </Layout>
  );
}

/** 根据稳定页面 ID 组合对应页面。 */
function PageContent({ page_id, range, refresh_key }: PageContentProps) {
  if (page_id === "overview") return <OverviewPage range={range} refresh_key={refresh_key} />;
  if (page_id === "activity") return <ActivityPage range={range} refresh_key={refresh_key} />;
  if (page_id === "consumption") return <ConsumptionPage range={range} refresh_key={refresh_key} />;
  if (page_id === "retention") return <RetentionPage range={range} refresh_key={refresh_key} />;
  if (page_id === "quality") return <QualityPage range={range} refresh_key={refresh_key} />;
  if (page_id === "usage") return <UsageUsersPage range={range} refresh_key={refresh_key} />;
  if (page_id === "debugger") return <DebuggerPage />;
  return <ResourcePage resource_id={page_id as ResourcePageId} refresh_key={refresh_key} />;
}

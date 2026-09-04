/** Fedman React 应用组合根。 */

import { useEffect, useState } from "react";
import { Layout } from "./components/Layout.js";
import { find_fedman_page } from "./config/pages.js";
import { use_remote_data } from "./hooks/use_remote_data.js";
import { request_json } from "./lib/api.js";
import { ActivityPage, ConsumptionPage, OverviewPage, QualityPage, RetentionPage } from "./pages/AnalyticsPages.js";
import { DebuggerPage } from "./pages/DebuggerPage.js";
import { ResourcePage } from "./pages/ResourcePage.js";
import { UsageUsersPage } from "./pages/UsageUsersPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MessageState } from "./components/Common.js";
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

  useEffect(() => {
    const handle_unauthorized = () => set_refresh_key((value) => value + 1);
    window.addEventListener("fedman:unauthorized", handle_unauthorized);
    return () => window.removeEventListener("fedman:unauthorized", handle_unauthorized);
  }, []);

  if (context_state.loading) return <MessageState tone="loading">正在连接本地控制面…</MessageState>;
  if (context_state.error || !context_state.data) {
    return <MessageState tone="error">{context_state.error?.message ?? "无法读取 Federation 连接信息。"}</MessageState>;
  }
  if (!context_state.data.authenticated) {
    return <LoginPage context={context_state.data} on_login={() => set_refresh_key((value) => value + 1)} />;
  }

  async function logout(): Promise<void> {
    await request_json<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    set_refresh_key((value) => value + 1);
  }

  return (
    <Layout page={page} range={range} context_state={context_state} on_page_change={set_page_id} on_range_change={set_range} on_refresh={() => set_refresh_key((value) => value + 1)} on_logout={() => void logout()}>
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

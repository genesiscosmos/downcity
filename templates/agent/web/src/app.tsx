/** React 产品入口：RemoteAgent 持有网络，UI connection 持有订阅，ChatPanel 持有展示。 */
import { useEffect, useState } from "react";
import { RemoteAgent } from "@downcity/city/browser";
import { ChatPanel, connect_chat_session, type DowncityChatConnection } from "@downcity/ui";
import type { ChatBootstrap } from "../../types/chat";

/** 通过官方 SDK 恢复服务端 Session，并在卸载时按所有权释放资源。 */
export function App() {
  const [connection, set_connection] = useState<DowncityChatConnection>();
  const [error, set_error] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let client: RemoteAgent | undefined;
    let current: DowncityChatConnection | undefined;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch("/api/chat", { signal: controller.signal });
      if (!response.ok) throw new Error("Unable to load the current Session");
      const bootstrap = await response.json() as ChatBootstrap;
      if (disposed) return;
      client = new RemoteAgent({ url: new URL(bootstrap.agent_url, location.origin).href });
      const session = await client.sessions.get(bootstrap.session_id, bootstrap.category);
      if (disposed) return;
      current = await connect_chat_session(session);
      if (disposed) current.close();
      else set_connection(current);
    })().catch(reason => { if (!disposed) set_error(String(reason)); });
    return () => { disposed = true; controller.abort(); current?.close(); void client?.close(); };
  }, []);
  return <main className="mx-auto flex h-dvh max-w-4xl flex-col bg-background px-4 py-3 text-foreground">
    {error ? <p role="alert">{error}</p> : connection ? <>
      <ChatPanel runtime={connection.runtime} title="Downcity Agent" />
      <button type="button" className="py-2 text-xs text-muted-foreground" onClick={() => { void connection.load_earlier().catch(reason => set_error(String(reason))); }}>Load earlier messages</button>
    </> : <p role="status">Connecting…</p>}
  </main>;
}

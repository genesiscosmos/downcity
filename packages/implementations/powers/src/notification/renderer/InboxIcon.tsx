/** Inbox使用的小型单色语义图标，尺寸和颜色由宿主样式控制。 */
import type { InboxEntry } from "../types/Inbox.js";

/** 图标只辅助文字，不独立传达审批或状态。 */
export function InboxIcon({ kind }: { /** 当前项目语义，空态使用inbox。 */ kind: InboxEntry["kind"] | "inbox" | "check" | "refresh" }) {
  const paths = {
    inbox: "M4 4h16v15H4z M4 12h5l1 3h4l1-3h5",
    question: "M5 4h14v12h-7l-5 4v-4H5z M10 8a2 2 0 014 0c0 2-2 2-2 4 M12 13v.1",
    approval: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
    secret: "M7 10V7a5 5 0 0110 0v3 M5 10h14v11H5z M12 14v3",
    update: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5",
    check: "M5 12l4 4L19 6",
    refresh: "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0112-1l2 3 M4 15l2 3a7 7 0 0012-1",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

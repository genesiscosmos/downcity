/** Inbox使用的小型单色语义图标，尺寸和颜色由宿主样式控制。 */
import type { InboxEntry } from "../types/Inbox.js";

/** 图标只辅助文字，不独立传达审批或状态。 */
export function InboxIcon({ kind }: { /** 当前项目语义，空态使用inbox。 */ kind: InboxEntry["kind"] | "inbox" | "check" | "failure" | "agent" | "close" }) {
  const paths = {
    inbox: "M4 4h16v15H4z M4 12h5l1 3h4l1-3h5",
    agent: "M5 21V10a7 7 0 0114 0v11l-3-2-4 2-4-2z M9 10v1 M15 10v1",
    question: "M5 4h14v12h-7l-5 4v-4H5z M10 8a2 2 0 014 0c0 2-2 2-2 4 M12 13v.1",
    approval: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
    secret: "M7 10V7a5 5 0 0110 0v3 M5 10h14v11H5z M12 14v3",
    update: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5",
    check: "M5 12l4 4L19 6",
    close: "M6 6l12 12 M18 6L6 18",
    failure: "M12 3L2 21h20z M12 9v5 M12 17v.1",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

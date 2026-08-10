/** Duobox Chat 使用的 Tabler 风格图标集合。统一 viewBox、线宽和端点，避免宿主字体或 icon 库造成视觉漂移。 */
import type { ReactNode, SVGProps } from "react";

type ChatIconProps = SVGProps<SVGSVGElement>;
function icon(path: ReactNode, props: ChatIconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{path}</svg>;
}
export function TbPlus(props: ChatIconProps) { return icon(<><path d="M12 5v14" /><path d="M5 12h14" /></>, props); }
export function TbLock(props: ChatIconProps) { return icon(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, props); }
export function TbShieldCheck(props: ChatIconProps) { return icon(<><path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4" /><path d="m9 12 2 2 4-4" /></>, props); }
export function TbArrowUp(props: ChatIconProps) { return icon(<><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>, props); }
export function TbSquare(props: ChatIconProps) { return icon(<rect x="6" y="6" width="12" height="12" rx="1" />, props); }
export function TbLoader2(props: ChatIconProps) { return icon(<path d="M12 3a9 9 0 1 0 9 9" />, props); }
export function TbChevronDown(props: ChatIconProps) { return icon(<path d="m6 9 6 6 6-6" />, props); }
export function TbPaperclip(props: ChatIconProps) { return icon(<path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />, props); }
export function TbRobot(props: ChatIconProps) { return icon(<><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" /></>, props); }
export function TbTerminal(props: ChatIconProps) { return icon(<><path d="m4 5 6 6-6 6" /><path d="M12 17h8" /></>, props); }
export function TbFile(props: ChatIconProps) { return icon(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>, props); }
export function TbCheck(props: ChatIconProps) { return icon(<path d="m5 12 4 4L19 6" />, props); }
export function TbChevronRight(props: ChatIconProps) { return icon(<path d="m9 6 6 6-6 6" />, props); }

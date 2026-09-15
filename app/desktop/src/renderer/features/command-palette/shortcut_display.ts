/**
 * Desktop 命令面板的键位展示格式化。
 *
 * 只负责「把键位弦转成当前平台的显示文本」，不承担快捷键注册、作用域与优先级。
 * Desktop 在 P0 阶段没有快捷键注册表（见 PRD 6.6），因此本模块刻意保持最小。
 */

/** 当前平台的修饰键习惯。 */
export type ShortcutPlatform = "mac" | "windows" | "linux";

/**
 * 键位展示映射。
 *
 * 键位弦使用 `Mod` 表示「平台主修饰键」：macOS 为 ⌘，其余平台为 Ctrl。
 * 表项只允许覆盖 Desktop 现有键盘分支已经实现的键位，面板不发明新快捷键。
 */
export const command_shortcuts: Readonly<Record<string, readonly string[]>> = {
  "nav.open-chat": ["Mod+1"],
  "nav.open-workspace": ["Mod+2"],
  "nav.open-plugins": ["Mod+3"],
  "nav.toggle-sidebar": ["Mod+B"],
  "nav.toggle-baybar": ["Mod+L"],
  "nav.open-settings": ["Mod+,"],
  "create.conversation": ["Mod+R"],
  "nav.back-from-settings": ["Escape"],
};

/** 读取一条命令的主键位展示文本；无键位时返回 undefined。 */
export function resolve_command_shortcut(command_id: string, platform: ShortcutPlatform): string | undefined {
  const chord = command_shortcuts[command_id]?.[0];
  return chord ? format_shortcut(chord, platform) : undefined;
}

/** 非 Vite 环境（Node 测试）或无 navigator 时回退到 mac，与 Desktop 现有实现一致。 */
export function detect_shortcut_platform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "mac";
  const value = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  const lower = value.toLowerCase();
  if (lower.includes("mac")) return "mac";
  if (lower.includes("win")) return "windows";
  return "linux";
}

/** 把一条键位弦格式化为当前平台的显示文本。 */
export function format_shortcut(chord: string, platform: ShortcutPlatform): string {
  const tokens = chord.split("+").map((token) => token.trim()).filter(Boolean);
  const formatted = tokens.map((token) => format_token(token, platform));
  return platform === "mac" ? formatted.join("") : formatted.join("+");
}

/** 逐 token 格式化；mac 使用符号，其余平台使用可读英文名。 */
function format_token(token: string, platform: ShortcutPlatform): string {
  const normalized = token.toLowerCase();
  switch (normalized) {
    case "mod":
      return platform === "mac" ? "⌘" : "Ctrl";
    case "meta":
    case "cmd":
    case "command":
      return platform === "mac" ? "⌘" : "Meta";
    case "ctrl":
    case "control":
      return platform === "mac" ? "⌃" : "Ctrl";
    case "alt":
    case "option":
      return platform === "mac" ? "⌥" : "Alt";
    case "shift":
      return platform === "mac" ? "⇧" : "Shift";
    case "enter":
    case "return":
      return platform === "mac" ? "↵" : "Enter";
    case "escape":
    case "esc":
      return "Esc";
    case "backspace":
      return platform === "mac" ? "⌫" : "Backspace";
    case "delete":
      return platform === "mac" ? "⌦" : "Delete";
    case "space":
      return platform === "mac" ? "␠" : "Space";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    default:
      return token.length === 1 ? token.toUpperCase() : normalized;
  }
}

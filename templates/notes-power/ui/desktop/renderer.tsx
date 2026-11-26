/** downcity.desktop.react.v1 入口，导出该协议的 Desktop 插槽定义。 */
import { define_power_renderer } from "@downcity/city/power/react";
import { NotesSidebar, NotesMainview } from "./notes_views.js";

export default define_power_renderer({ sidebar: NotesSidebar, mainview: NotesMainview });

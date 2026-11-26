/** Notes 扩展项目入口：只装配后端实例，不导入任何宿主 UI。 */
import { NotesPower } from "./src/notes_power.js";

export default { powers: [new NotesPower()] };

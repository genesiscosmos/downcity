/** Notes 前后端共享的纯数据契约，不导入 Node、Power 实例或宿主 UI。 */

/** 允许在列表中展示的笔记摘要。 */
export interface NoteSummary {
  /** 后端分配的稳定笔记身份。 */
  note_id: string;
  /** 导航和列表使用的短标题。 */
  title: string;
}

/** notes.list 宿主业务动作返回的数据。 */
export interface NotesListResult {
  /** 当前调用范围内可见的笔记摘要，空列表同样是成功结果。 */
  notes: NoteSummary[];
}

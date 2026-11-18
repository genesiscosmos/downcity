/** 胶囊控件共享选中背景的布局快照，用于区分选项切换与尺寸变化。 */

export interface SelectionIndicatorLayout {
  /** 当前布局对应的稳定选项值；选项值变化才播放位移动画。 */
  value: string;
  /** 选项相对定位容器左缘的偏移，单位为 CSS 像素。 */
  left: number;
  /** 选项相对定位容器上缘的偏移，单位为 CSS 像素。 */
  top: number;
  /** 当前选项的布局宽度，单位为 CSS 像素。 */
  width: number;
  /** 当前选项的布局高度，单位为 CSS 像素。 */
  height: number;
}

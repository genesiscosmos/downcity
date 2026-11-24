/** 领域详情的共享错误边界；单个 Power 展示失败不卸载整条会话。 */
import { Component, type ReactNode } from "react";
/** 只持有当前详情的局部失败状态，不重试业务或执行工具。 */
export class ActivityDetailBoundary extends Component<{
  /** 已本地化的简短错误说明。 */ fallback: string;
  /** 仅在活动展开后挂载的领域详情。 */ children: ReactNode;
}, { /** 当前详情组件是否抛出渲染错误。 */ failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">{this.props.fallback}</p> : this.props.children; }
}

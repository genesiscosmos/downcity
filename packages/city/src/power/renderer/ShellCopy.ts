/** Shell 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "../types/PowerActivityRenderer.js";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "exec": {
    running: ["正在执行命令", "Running command"],
    complete: ["已执行命令", "Executed command"],
    failed: ["未能执行命令", "Could not execute command"],
    waiting: ["等待你允许运行命令", "Waiting for permission to run the command"],
  },
  "session_start": {
    running: ["正在启动终端会话", "Starting terminal session"],
    complete: ["已启动终端会话", "Started terminal session"],
    failed: ["未能启动终端会话", "Could not start terminal session"],
    waiting: ["等待你允许启动终端会话", "Waiting for permission to start the terminal session"],
  },
  "session_send": {
    running: ["正在发送终端输入", "Sending terminal input"],
    complete: ["已发送终端输入", "Sent terminal input"],
    failed: ["未能发送终端输入", "Could not send terminal input"],
    waiting: ["等待你允许发送终端输入", "Waiting for permission to send terminal input"],
  },
  "session_read": {
    running: ["正在读取终端输出", "Reading terminal output"],
    complete: ["已读取终端输出", "Read terminal output"],
    failed: ["未能读取终端输出", "Could not read terminal output"],
    waiting: ["等待你允许读取终端输出", "Waiting for permission to read terminal output"],
  },
  "session_list": {
    running: ["正在查看终端会话", "Checking terminal sessions"],
    complete: ["已查看终端会话", "Checked terminal sessions"],
    failed: ["未能查看终端会话", "Could not list terminal sessions"],
    waiting: ["等待你允许查看终端会话", "Waiting for permission to check terminal sessions"],
  },
  "session_stop": {
    running: ["正在关闭终端会话", "Closing terminal session"],
    complete: ["已关闭终端会话", "Closed terminal session"],
    failed: ["未能关闭终端会话", "Could not close terminal session"],
    waiting: ["等待你允许关闭终端会话", "Waiting for permission to close the terminal session"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Checked available actions"],
    failed: ["未能查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备命令", "Preparing command"],
    complete: ["已处理命令", "Processed command"],
    failed: ["未能处理命令", "Could not complete command"],
    waiting: ["等待你确认命令", "Waiting for confirmation about the command"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备命令", "Preparing command"];

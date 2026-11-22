/** Web 自有活动文案：各动作的完整中英文句子；业务阶段由本 Power 的结果投影选择。 */
import type { PowerActivityDescription } from "@downcity/city/power/react";

/** 键为精确 action；四个阶段的数组依次为中文、英文，不拼通用完成前缀。 */
export const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "status": {
    running: ["正在检查网页访问", "Checking web access"],
    complete: ["已检查网页访问", "Web access checked"],
    failed: ["无法检查网页访问", "Could not check web access"],
    waiting: ["等待你允许检查网页访问", "Waiting for permission to check web access"],
  },
  "search": {
    running: ["正在搜索网页", "Searching the web"],
    complete: ["网页搜索已结束", "Web search finished"],
    failed: ["网页搜索失败", "Web search failed"],
    waiting: ["等待你允许搜索网页", "Waiting for permission to search the web"],
  },
  "open": {
    running: ["正在读取网页", "Reading page"],
    complete: ["已读取网页", "Page read"],
    failed: ["网页读取失败", "Could not read page"],
    waiting: ["等待你允许读取网页", "Waiting for permission to read the page"],
  },
  "browser_create_session": {
    running: ["正在打开页面", "Opening page"],
    complete: ["页面已打开", "Page opened"],
    failed: ["页面打开失败", "Could not open page"],
    waiting: ["等待你允许打开页面", "Waiting for permission to open the page"],
  },
  "browser_observe": {
    running: ["正在查看页面", "Checking page"],
    complete: ["已查看页面", "Page checked"],
    failed: ["无法查看页面", "Could not check page"],
    waiting: ["等待你允许查看页面", "Waiting for permission to check the page"],
  },
  "browser_act": {
    running: ["正在操作页面", "Interacting with page"],
    complete: ["页面操作已完成", "Page interaction finished"],
    failed: ["页面操作失败", "Page interaction failed"],
    waiting: ["等待你允许操作页面", "Waiting for permission to interact with the page"],
  },
  "browser_semantic_act": {
    running: ["正在操作页面", "Interacting with page"],
    complete: ["页面操作已完成", "Page interaction finished"],
    failed: ["页面操作失败", "Page interaction failed"],
    waiting: ["等待你允许操作页面", "Waiting for permission to interact with the page"],
  },
  "browser_extract": {
    running: ["正在读取页面内容", "Reading page content"],
    complete: ["已读取页面内容", "Page content read"],
    failed: ["页面内容读取失败", "Could not read page content"],
    waiting: ["等待你允许读取页面内容", "Waiting for permission to read page content"],
  },
  "browser_semantic_extract": {
    running: ["正在读取页面内容", "Reading page content"],
    complete: ["已读取页面内容", "Page content read"],
    failed: ["页面内容读取失败", "Could not read page content"],
    waiting: ["等待你允许读取页面内容", "Waiting for permission to read page content"],
  },
  "browser_list_sessions": {
    running: ["正在查看已打开页面", "Checking open pages"],
    complete: ["已查看已打开页面", "Open pages checked"],
    failed: ["无法查看已打开页面", "Could not list open pages"],
    waiting: ["等待你允许查看已打开页面", "Waiting for permission to check open pages"],
  },
  "browser_close_session": {
    running: ["正在关闭页面", "Closing page"],
    complete: ["页面已关闭", "Page closed"],
    failed: ["页面关闭失败", "Could not close page"],
    waiting: ["等待你允许关闭页面", "Waiting for permission to close the page"],
  },
  "": {
    running: ["正在查看可用功能", "Checking available actions"],
    complete: ["已查看可用功能", "Available actions checked"],
    failed: ["无法查看可用功能", "Could not check available actions"],
    waiting: ["等待你允许查看可用功能", "Waiting for permission to check available actions"],
  },
  "unknown": {
    running: ["正在准备访问网页", "Preparing to access the web"],
    complete: ["网页访问已结束", "Web access finished"],
    failed: ["网页访问未能完成", "Could not access the web"],
    waiting: ["等待你允许访问网页", "Waiting for permission to access the web"],
  },
};

/** 参数尚未收口时只说明正在准备，不提前推断 action。 */
export const preparing_sentence: readonly [string, string] = ["正在准备访问网页", "Preparing to access the web"];

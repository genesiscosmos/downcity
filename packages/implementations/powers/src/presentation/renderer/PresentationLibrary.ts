/** OpenUI 浏览器组件目录；服务端契约由构建脚本同源导出，不加载 React。 */
import { createLibrary } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { COMPOUND_VALUES, YEAR_LABELS } from "../Functions.js";
import { adapt_presentation_media } from "./PresentationMedia.js";

/** 正文内容目录：配套 Item 同时注册，编辑表格、弹窗和远程执行仍不开放。 */
const component_names = [
  "Stack", "Card", "CardHeader", "TextContent", "Callout", "TextCallout", "InlineHeader", "Separator",
  "Table", "Col", "BarChart", "LineChart", "AreaChart", "HorizontalBarChart", "Series", "PieChart", "Slice",
  "Form", "FormControl", "Label", "Input", "TextArea", "Select", "SelectItem", "Slider",
  "Button", "Buttons", "Tabs", "TabItem", "Accordion", "AccordionItem", "TagBlock", "Tag",
  "Text", "BoldText", "MetricIndicatorInline", "MetricIndicatorWithStrikethrough",
  "SnippetCardItem", "SnippetCardBlock", "OverviewCardItem", "OverviewCardBlock",
  "ContextCardItem", "ContextCardBlock", "CompositeCardItem", "CompositeCardBlock", "VisualCardItem", "VisualCardBlock",
  "EntityList", "ListBlock", "ListItem", "Steps", "StepsItem", "Carousel",
  "Icon", "IconText", "IconButton",
  "DatePicker", "CheckBoxGroup", "CheckBoxItem", "RadioGroup", "RadioItem",
  "SwitchGroup", "SwitchItem", "Chips", "ChipItem", "OptionCards", "OptionCard",
  "MarkDownRenderer", "CodeBlock", "Image", "ImageBlock", "ImageGallery", "ImageText", "ImageTextLarge",
];

/** 全局稳定目录，组件与参数位置直接来自固定版本上游。 */
export const PRESENTATION_LIBRARY = createLibrary({
  id: "downcity.presentation.openui.v1",
  root: "Stack",
  functions: [COMPOUND_VALUES, YEAR_LABELS],
  components: component_names.map((name) => adapt_presentation_media(openuiLibrary.components[name]!)),
});

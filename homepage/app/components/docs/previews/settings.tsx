/**
 * Settings 示例。
 */
import {
  InfoRow,
  SettingGroup,
  SettingItem,
  SettingList,
  SettingSection,
  SettingsContainer,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@downcity/ui";

export default function SettingsPreview() {
  return (
    <SettingsContainer className="w-full max-w-md">
      <SettingSection title="Runtime" description="Applies to every session in this city.">
        <SettingGroup>
          <SettingList>
            <SettingItem label="Stream responses" description="Show tokens as they arrive.">
              <Switch defaultChecked />
            </SettingItem>
            <SettingItem
              label="Default model"
              description="Used when a session does not override it."
            >
              <Select defaultValue="deepseek-chat">
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deepseek-chat">deepseek-chat</SelectItem>
                  <SelectItem value="deepseek-reasoner">deepseek-reasoner</SelectItem>
                </SelectContent>
              </Select>
            </SettingItem>
          </SettingList>
        </SettingGroup>
      </SettingSection>
      <SettingSection title="Diagnostics">
        <SettingList>
          <InfoRow label="Version">0.1.279</InfoRow>
          <InfoRow label="Sandbox">native</InfoRow>
        </SettingList>
      </SettingSection>
    </SettingsContainer>
  );
}

// packages/ui-rlm-workspace/src/SkillComposerExtra.tsx — UI-plugin RLM
// (docs/agent-core-rlm-web-ui-plugin-plan.md): dropdown chọn skill, cạnh
// Composer trong footer của AppFrame.
//
// Follow-up: đổi từ native <select> sang `Select` (packages/ui-primitives) —
// user yêu cầu rõ "dropdown menu là UI riêng theo theme của web" (native
// select không style được popup, browser tự vẽ theo OS) "và hiện phía
// trên" (trigger nằm sát đáy viewport, cạnh ô nhập chat — popup phải mở
// NGƯỢC LÊN, xuống dưới sẽ tràn màn hình/đè lên composer) — dùng
// `direction="up"`. `skills` giữ NGUYÊN shape cũ ({name, description} —
// khớp response GET /skills, App.tsx không cần đổi gì) — chỉ map sang
// `SelectOption` ({value, label, description}) ngay tại đây cho `Select`.
import { Select, type SelectOption } from '@agent-core/ui-primitives'
import styles from './SkillComposerExtra.module.css'

export interface SkillOption {
  name: string
  description: string
}

export interface SkillComposerExtraProps {
  skills: SkillOption[]
  selectedSkill: string
  disabled: boolean
  onSelectSkill: (name: string) => void
}

export function SkillComposerExtra({ skills, selectedSkill, disabled, onSelectSkill }: SkillComposerExtraProps) {
  const options: SelectOption[] = skills.map((skill) => ({ value: skill.name, label: skill.name, description: skill.description }))

  return (
    <Select
      className={styles.select}
      ariaLabel="Chọn skill"
      placeholder="Tự động"
      disabled={disabled}
      value={selectedSkill}
      options={options}
      direction="up"
      onChange={onSelectSkill}
    />
  )
}

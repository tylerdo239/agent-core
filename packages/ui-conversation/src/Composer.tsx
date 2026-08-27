// apps/web/src/Composer.tsx — UI redesign (2026-08): tách ra khỏi App.tsx
// (trước đây <input type="text"> đơn dòng, không hỗ trợ xuống dòng) + sửa
// gap chức năng thật: đổi sang <textarea> tự giãn cao theo nội dung (kỹ
// thuật scrollHeight chuẩn), Enter gửi/Shift+Enter xuống dòng.
//
// Follow-up (2026-08) — chọn skill kiểu slash-command: trước đây skill chỉ
// chọn được qua dropdown riêng (SkillComposerExtra, packages/ui-rlm-
// workspace), CHỈ hiện cho session driver 'rlm' (đăng ký qua RenderSlot
// entryKey='rlm') — chat thường (driver 'default') không có cách nào chọn
// skill dù backend (loop-default gọi resolveActiveSkills(..., input.
// selectedSkill)) đã hỗ trợ sẵn từ trước, đây thuần là gap UI. Gộp thẳng
// vào Composer (dùng CHUNG cho mọi driver, không qua RenderSlot nữa) vừa
// sửa gap đó vừa thay hẳn cơ chế: gõ "/" ở ĐẦU ô nhập mở popup lọc theo tên/
// mô tả skill (Enter/click chọn, Escape/xoá dấu "/" đóng lại) — không cần
// portal ra document.body như Select.tsx vì footer AppFrame không nằm
// trong ancestor nào `overflow:hidden` cắt mất popup (position: absolute
// thuần trong .form là đủ, xem AppFrame.module.css).
import { useEffect, useRef, useState } from 'react'
import { Button } from '@agent-core/ui-primitives'
import { X } from 'lucide-react'
import styles from './Composer.module.css'

const MAX_HEIGHT_PX = 160

export interface SkillOption {
  name: string
  description: string
}

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  /** Gate theo trạng thái kết nối/session/turn — KHÔNG theo nội dung rỗng
   * hay không (textarea vẫn phải gõ được lúc rỗng, chỉ nút Gửi mới dim khi
   * rỗng — xem canSend bên dưới). */
  disabled: boolean
  /** Danh sách skill user-invocable (GET /skills) — rỗng thì gõ "/" không mở gì. */
  skills: SkillOption[]
  /** Tên skill đang chọn cho lượt tiếp theo ('' = tự động, không ép skill). */
  selectedSkill: string
  onSelectSkill: (name: string) => void
}

export function Composer({ value, onChange, onSubmit, disabled, skills, selectedSkill, onSelectSkill }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  // Menu chỉ mở khi "/" là KÝ TỰ ĐẦU của toàn bộ nội dung ô nhập (không phải
  // "/" xuất hiện giữa câu) — đúng quy ước slash-command phổ biến, tránh mở
  // nhầm khi user gõ URL hay đường dẫn có dấu "/" trong tin nhắn thường.
  const slashQuery = value.startsWith('/') ? value.slice(1).toLowerCase() : null
  const filteredSkills =
    slashQuery === null
      ? []
      : skills.filter((skill) => skill.name.toLowerCase().includes(slashQuery) || skill.description.toLowerCase().includes(slashQuery))
  const menuOpen = slashQuery !== null && !disabled

  useEffect(() => {
    setActiveIndex(0)
  }, [slashQuery])

  function chooseSkill(skill: SkillOption) {
    onSelectSkill(skill.name)
    onChange('')
    textareaRef.current?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => Math.min(index + 1, Math.max(filteredSkills.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => Math.max(index - 1, 0))
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const skill = filteredSkills[activeIndex]
        if (skill) chooseSkill(skill)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onChange('')
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const canSend = !disabled && value.trim().length > 0

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {selectedSkill && (
        <button
          type="button"
          className={styles.skillChip}
          onClick={() => onSelectSkill('')}
          aria-label={`Bỏ chọn skill ${selectedSkill}`}
          title="Bỏ chọn skill — lượt tiếp theo model tự chọn skill phù hợp"
        >
          /{selectedSkill}
          <X size={12} aria-hidden="true" />
        </button>
      )}
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        placeholder="Nhắn gì đó cho agent..."
        rows={1}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button type="submit" variant="primary" className={styles.send} disabled={!canSend}>
        Gửi
      </Button>
      {menuOpen && (
        <ul className={styles.skillMenu} role="listbox" aria-label="Chọn skill">
          {filteredSkills.length === 0 ? (
            <li className={styles.skillMenuEmpty}>Không tìm thấy skill phù hợp</li>
          ) : (
            filteredSkills.map((skill, index) => (
              <li
                key={skill.name}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? `${styles.skillOption} ${styles.skillOptionActive}` : styles.skillOption}
                onMouseEnter={() => setActiveIndex(index)}
                // mousedown (không phải click) — chạy TRƯỚC blur của textarea,
                // chọn được ngay lần nhấn đầu (cùng kỹ thuật Select.tsx).
                onMouseDown={(event) => { event.preventDefault(); chooseSkill(skill) }}
              >
                <span className={styles.skillOptionName}>{skill.name}</span>
                <span className={styles.skillOptionDescription}>{skill.description}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </form>
  )
}

// packages/ui-primitives/src/Select.tsx — dropdown THEO THEME của app, thay
// native <select> (không style được popup của nó — browser tự vẽ theo OS,
// không theo design token) — user yêu cầu rõ: "dropdown menu là UI riêng
// theo theme của web". Cùng kỹ thuật portal đã dùng ở Tooltip.tsx (không
// thêm thư viện positioning ngoài, coding rule A6): render popup vào
// `document.body`, toạ độ tính bằng `getBoundingClientRect()`, thoát được
// mọi ancestor `overflow: hidden`/`overflow: auto` có thể cắt mất popup.
//
// `direction="up"` (mới, khác Tooltip LUÔN hiện dưới): dùng cho trigger nằm
// gần đáy viewport (vd. cạnh ô nhập chat) — popup mở NGƯỢC lên, không bị
// tràn ra ngoài màn hình/đè lên composer bên dưới.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import styles from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
  description?: string
}

export interface SelectProps {
  value: string
  options: SelectOption[]
  /** Hiện khi `value` rỗng và không khớp option nào (vd. "Tự động"). */
  placeholder: string
  ariaLabel: string
  disabled?: boolean
  /** Popup mở lên trên hay xuống dưới trigger — mặc định 'down'. */
  direction?: 'up' | 'down'
  onChange: (value: string) => void
  className?: string
}

const GAP_PX = 6

export function Select({ value, options, placeholder, ariaLabel, disabled, direction = 'down', onChange, className }: SelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const [open, setOpen] = useState(false)
  // minWidth (không phải width cố định) — trigger giờ tự co theo nội dung
  // (align-self: flex-start, xem Select.module.css), nếu popup cũng lấy
  // đúng width đó thì option dài sẽ bị ellipsis cắt theo chiều rộng của
  // TRIGGER thay vì theo chính nó. Popup chỉ cần căn trái khớp trigger,
  // rộng ra tự do theo nội dung (min-width/max-width xử lý ở CSS).
  const [pos, setPos] = useState<{ left: number; minWidth: number; top?: number; bottom?: number }>({ left: 0, minWidth: 0 })
  const [activeIndex, setActiveIndex] = useState(0)

  const selected = options.find((o) => o.value === value)

  function openMenu() {
    if (disabled) return
    const el = triggerRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      setPos(
        direction === 'up'
          ? { left: rect.left, minWidth: rect.width, bottom: window.innerHeight - rect.top + GAP_PX }
          : { left: rect.left, minWidth: rect.width, top: rect.bottom + GAP_PX },
      )
    }
    const current = options.findIndex((o) => o.value === value)
    setActiveIndex(current >= 0 ? current : 0)
    setOpen(true)
  }

  function closeMenu() {
    setOpen(false)
  }

  function choose(v: string) {
    onChange(v)
    closeMenu()
    triggerRef.current?.focus()
  }

  // Click ra ngoài (cả trigger lẫn popup portal-ed ra document.body — 2 cây
  // DOM tách rời, không thể chỉ check "bên trong 1 wrapper chung" như
  // pattern thường) -> đóng menu.
  useEffect(() => {
    if (!open) return
    function onMouseDown(event: globalThis.MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      closeMenu()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, options.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[activeIndex]
      if (option) choose(option.value)
    }
  }

  // mousedown (không phải click) trên option — chạy TRƯỚC blur của trigger,
  // chọn được ngay lần nhấn đầu thay vì phải nhấn 2 lần.
  function handleOptionMouseDown(event: MouseEvent<HTMLLIElement>, optionValue: string) {
    event.preventDefault()
    choose(optionValue)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className ? `${styles.trigger} ${className}` : styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={selected?.description}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={styles.triggerLabel}>{selected ? selected.label : placeholder}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}
        />
      </button>
      {open &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            className={styles.list}
            style={{ left: pos.left, minWidth: pos.minWidth, top: pos.top, bottom: pos.bottom }}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                title={option.description}
                className={index === activeIndex ? `${styles.option} ${styles.optionActive}` : styles.option}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => handleOptionMouseDown(event, option.value)}
              >
                {option.label}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  )
}

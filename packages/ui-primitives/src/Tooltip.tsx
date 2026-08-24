// packages/ui-primitives/src/Tooltip.tsx — tooltip CSS thuần (hover/focus),
// KHÔNG dùng thư viện positioning ngoài (floating-ui...) — đủ cho nhu cầu
// thật hiện tại (label ngắn trên nút icon, LUÔN hiện phía dưới — không cần
// logic auto-flip theo viewport, coding rule A6).
//
// Gap thật (2026-08, follow-up): bản CSS-thuần cũ định vị bubble bằng
// `position: absolute` LỒNG bên trong `.wrapper` — bất kỳ ancestor nào có
// `overflow: hidden`/`overflow: auto` (vd. #sidebar cuộn danh sách lịch sử)
// sẽ CẮT MẤT bubble dù z-index cao thế nào (z-index không "thoát" được
// clipping context của ancestor — giới hạn CSS thật, không phải bug code).
// Sửa bằng `createPortal` vào `document.body` (đã có sẵn react-dom, không
// thêm dependency) — bubble render NGOÀI cây DOM của mọi ancestor có thể
// clip nó, vị trí tính bằng `getBoundingClientRect()` của chính wrapper lúc
// hover/focus. Bubble vẫn LUÔN mount trong DOM (ẩn qua opacity/visibility,
// không phải conditional render) — giữ đúng hành vi cũ mà
// `primitives.test.tsx` đã test (role="tooltip" tồn tại ngay cả khi chưa
// hover).
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  label: string
  children: ReactNode
}

const GAP_PX = 6

export function Tooltip({ label, children }: TooltipProps) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  function show() {
    const el = wrapperRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      setPos({ top: rect.bottom + GAP_PX, left: rect.left + rect.width / 2 })
    }
    setOpen(true)
  }

  function hide() {
    setOpen(false)
  }

  return (
    <span ref={wrapperRef} className={styles.wrapper} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {createPortal(
        <span
          className={open ? `${styles.bubble} ${styles.bubbleOpen}` : styles.bubble}
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  )
}

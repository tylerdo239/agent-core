// packages/ui-primitives/src/Modal.tsx — wrap pattern <dialog>/showModal()/
// close() thủ công (trước đây inline trong apps/web/src/App.tsx) thành 1
// component tái sử dụng được — vẫn dùng <dialog> gốc (accessibility có sẵn
// từ trình duyệt: Esc để đóng, focus trap, backdrop), chỉ đóng gói phần
// imperative ref/effect.
//
// Follow-up (2026-08): click ra ngoài (backdrop) để đóng — trước đây chỉ
// đóng được bằng Esc. Kỹ thuật chuẩn cho <dialog>: so sánh event.target với
// chính phần tử dialog — click LÊN backdrop (::backdrop không phải phần tử
// thật, hit-test rơi vào chính <dialog>) có target === dialog; click vào
// bên trong nội dung (children) có target là 1 descendant, KHÔNG so khớp —
// chỉ đúng vì `.dialog` có `padding: 0` (không có khoảng trống nào giữa mép
// dialog và children để "click trúng dialog nhưng vẫn coi là bên trong").
// `className` (mới): cho phép nơi gọi thêm style riêng (vd. đổi vị trí modal
// lên gần đầu màn hình thay vì giữa) mà không cần Modal biết về từng biến
// thể.
import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, children, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) ref.current?.showModal()
    else ref.current?.close()
  }, [open])

  function handleDialogClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose()
  }

  return (
    <dialog
      ref={ref}
      className={className ? `${styles.dialog} ${className}` : styles.dialog}
      onClose={onClose}
      onClick={handleDialogClick}
    >
      {children}
    </dialog>
  )
}

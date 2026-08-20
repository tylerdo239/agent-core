// packages/ui-primitives/src/Modal.tsx — wrap pattern <dialog>/showModal()/
// close() thủ công (trước đây inline trong apps/web/src/App.tsx) thành 1
// component tái sử dụng được — vẫn dùng <dialog> gốc (accessibility có sẵn
// từ trình duyệt: Esc để đóng, focus trap, backdrop), chỉ đóng gói phần
// imperative ref/effect.
import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function Modal({ open, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) ref.current?.showModal()
    else ref.current?.close()
  }, [open])

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose}>
      {children}
    </dialog>
  )
}

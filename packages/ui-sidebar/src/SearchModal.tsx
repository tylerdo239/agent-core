// apps/web/src/SearchModal.tsx — follow-up: search chuyển từ ô input mở
// rộng ngay trong sidebar (đọc bài trước) sang 1 modal giữa màn hình (nền
// mờ blur — xem Modal.module.css), kèm debounce + skeleton lúc "đang tải".
//
// Lọc session vẫn client-side thuần (sessions đã có sẵn qua prop, không gọi
// API mới) — KHÔNG có độ trễ thật nào cần chờ. Debounce ở đây là 1 quyết
// định UX có chủ đích (chờ user NGỪNG gõ rồi mới hiện kết quả, tránh nhấp
// nháy list mỗi phím gõ), skeleton hiện đúng trong khoảng debounce đang chờ
// — không phải giả lập độ trễ mạng không có thật.
//
// Follow-up thứ 2 (2026-08): (1) modal ghim gần đầu màn hình thay vì giữa
// (`styles.searchDialog`, margin-top cố định đè lên margin:auto canh giữa
// mặc định của <dialog>) — để lúc skeleton<->kết quả đổi chiều cao, modal
// không "nhảy" vị trí do bị canh giữa lại; (2) nút X đóng cuối ô input; (3)
// click ra ngoài (backdrop) để đóng — cả 2 đến từ prop mới của Modal
// (className, xử lý click backdrop có sẵn trong chính Modal.tsx).
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Modal, Skeleton } from "@agent-core/ui-primitives";
import type { SessionSummary } from "./sessionHistory.ts";
import styles from "./SearchModal.module.css";

export interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  sessions: SessionSummary[];
  onSelectSession: (id: string) => void;
}

const DEBOUNCE_MS = 300;

export function SearchModal({
  open,
  onClose,
  sessions,
  onSelectSession,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset mỗi lần modal MỞ lại — không giữ query cũ từ lần tìm trước, và tự
  // focus vào input (đợi 1 tick vì <dialog>.showModal() cần render xong).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setDebouncedQuery("");
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const searching = query !== debouncedQuery;
  const trimmed = debouncedQuery.trim().toLowerCase();
  const results = trimmed
    ? sessions.filter((s) => s.title.toLowerCase().includes(trimmed))
    : sessions;

  function handleSelect(id: string) {
    onSelectSession(id);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} className={styles.searchDialog}>
      <div className={styles.wrap}>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Tìm cuộc trò chuyện..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Đóng tìm kiếm"
            onClick={onClose}
          >
            <X size={32} aria-hidden="true" />
          </button>
        </div>
        <div
          className={styles.results}
          aria-live="polite"
          aria-busy={searching}
        >
          {searching ? (
            <>
              <span className={styles.srOnly}>Đang tìm kiếm…</span>
              <Skeleton rows={3} />
            </>
          ) : results.length === 0 ? (
            <p className={styles.empty}>
              Không tìm thấy cuộc trò chuyện nào phù hợp
            </p>
          ) : (
            <ul className={styles.list}>
              {results.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => handleSelect(s.id)}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

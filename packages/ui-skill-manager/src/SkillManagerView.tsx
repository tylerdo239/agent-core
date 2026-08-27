// packages/ui-skill-manager/src/SkillManagerView.tsx — nút "Kỹ năng" ở
// SIDEBAR TRÊN, cạnh "Phân tích dữ liệu" (KHÔNG phải footer admin-only, xem
// packages/ui-sidebar/src/Sidebar.tsx) mở PANEL NÀY thế chỗ khung chat trong
// AppFrame (đúng pattern packages/ui-projects/src/ProjectHub.tsx — "Phân
// tích dữ liệu" cũng làm vậy), KHÔNG PHẢI Modal như bản nháp đầu (user chỉnh
// lại rõ ràng: "phải mở 1 panel trong khung chat như quản lý dự án").
//
// Mỗi user tự thêm/sửa/xoá skill riêng của mình (chèn vào system prompt của
// CHÍNH session họ tạo) — quản lý qua REST /custom-skills (ctx.customSkills,
// Postgres, có hiệu lực ngay không cần restart). Xem
// docs/agent-core-user-custom-skill-plan.md.
//
// File .md: user chọn qua <input type="file"> (đúng pattern handleFileChange
// của packages/ui-rlm-workspace/src/WorkspaceHeaderPanel.tsx), đọc bằng
// FileReader.readAsText() rồi đổ vào Textarea NGAY — user thấy/sửa được nội
// dung trước khi Lưu, không phải black-box upload. Gửi lên server dạng JSON
// bình thường (instructions là string) — không cần multipart parser mới.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Plus, Sparkles } from 'lucide-react'
import { Skeleton, Textarea, TextField } from '@agent-core/ui-primitives'
import {
  type CustomSkill,
  createCustomSkill,
  deleteCustomSkill,
  listCustomSkills,
  updateCustomSkill,
} from './customSkillApi.ts'
import styles from './SkillManagerView.module.css'

export interface SkillManagerViewProps {
  restUrl: string
  token: string
  /** Gọi sau mỗi lần tạo/sửa/xoá skill THÀNH CÔNG — App.tsx dùng để refetch
   * catalog cho dropdown "Chọn skill" trong Composer (state đó sống ở
   * App.tsx, tách khỏi panel này, không tự đồng bộ nếu không có callback
   * này). Xem docs/agent-core-user-custom-skill-plan.md. */
  onChanged?: () => void
}

interface DraftState {
  originalName: string | null // null = đang tạo mới; có giá trị = đang sửa skill này
  name: string
  description: string
  triggers: string
  instructions: string
}

const EMPTY_DRAFT: DraftState = { originalName: null, name: '', description: '', triggers: '', instructions: '' }

function toDraft(skill: CustomSkill): DraftState {
  return {
    originalName: skill.name,
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers.join(', '),
    instructions: skill.instructions,
  }
}

export function SkillManagerView({ restUrl, token, onChanged }: SkillManagerViewProps) {
  const [skills, setSkills] = useState<CustomSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(undefined)
    listCustomSkills(restUrl, token)
      .then(setSkills)
      .catch((err) => setError(err instanceof Error ? err.message : 'không tải được danh sách skill'))
      .finally(() => setLoading(false))
  }, [restUrl, token])

  const sorted = useMemo(() => [...skills].sort((a, b) => a.name.localeCompare(b.name)), [skills])

  function startCreate() {
    setError(undefined)
    setDraft({ ...EMPTY_DRAFT })
  }

  function startEdit(skill: CustomSkill) {
    setError(undefined)
    setDraft(toDraft(skill))
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !draft) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setDraft((prev) => {
        if (!prev) return prev
        // Gợi ý tên từ tên file khi đang TẠO MỚI và user chưa tự gõ tên —
        // không đụng tên lúc đang SỬA (originalName cố định, đổi tên không
        // được hỗ trợ qua update, xem ctx.customSkills.update()).
        const suggestedName = prev.originalName === null && !prev.name
          ? file.name.replace(/\.(md|markdown|txt)$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
          : prev.name
        return { ...prev, instructions: text, name: suggestedName }
      })
    }
    reader.readAsText(file)
  }

  async function handleSave() {
    if (!draft) return
    setBusy(true)
    setError(undefined)
    try {
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        instructions: draft.instructions,
        triggers: draft.triggers.split(',').map((t) => t.trim()).filter(Boolean),
      }
      const saved = draft.originalName
        ? await updateCustomSkill(restUrl, token, draft.originalName, input)
        : await createCustomSkill(restUrl, token, input)
      setSkills((prev) => {
        const rest = prev.filter((s) => s.name !== saved.name && s.name !== draft.originalName)
        return [...rest, saved]
      })
      setDraft(null)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không lưu được skill')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(name: string) {
    setBusy(true)
    setError(undefined)
    try {
      await deleteCustomSkill(restUrl, token, name)
      setSkills((prev) => prev.filter((s) => s.name !== name))
      if (draft?.originalName === name) setDraft(null)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không xoá được skill')
    } finally {
      setBusy(false)
    }
  }

  if (draft) {
    return (
      <section className={styles.hub} aria-label={draft.originalName ? `Sửa kỹ năng ${draft.originalName}` : 'Skill mới'}>
        <div className={styles.detailHeader}>
          <button type="button" className={styles.back} onClick={() => setDraft(null)} aria-label="Quay lại danh sách kỹ năng">
            <ArrowLeft size={18} />
          </button>
          <Sparkles size={22} aria-hidden="true" />
          <h1>{draft.originalName ?? 'Skill mới'}</h1>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.form}>
          <TextField
            label="Tên (slug)"
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
            placeholder="vd. meeting-notes"
            disabled={draft.originalName !== null}
          />
          <TextField
            label="Mô tả ngắn"
            value={draft.description}
            onChange={(description) => setDraft({ ...draft, description })}
            placeholder="Khi nào skill này nên được dùng"
          />
          <TextField
            label="Trigger (cách nhau bởi dấu phẩy)"
            value={draft.triggers}
            onChange={(triggers) => setDraft({ ...draft, triggers })}
            placeholder="vd. meeting, họp, biên bản"
          />
          <div className={styles.fileRow}>
            <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt" onChange={handleFileChange} className={styles.fileInput} />
            <span className={styles.fileHint}>hoặc dán/gõ trực tiếp bên dưới</span>
          </div>
          <Textarea
            label="Nội dung (.md)"
            value={draft.instructions}
            onChange={(instructions) => setDraft({ ...draft, instructions })}
            placeholder="# Hướng dẫn..."
          />
          <div className={styles.formActions}>
            <button type="button" className={styles.secondary} onClick={() => setDraft(null)} disabled={busy}>
              Huỷ
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={handleSave}
              disabled={busy || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()}
            >
              {draft.originalName ? 'Lưu' : 'Tạo'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.hub} aria-label="Kỹ năng">
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Skill riêng của bạn</p>
          <h1>Kỹ năng</h1>
        </div>
        <button type="button" className={styles.primary} onClick={startCreate}>
          <Plus size={17} /> Thêm skill mới
        </button>
      </div>
      <p className={styles.hint}>
        Skill là 1 đoạn hướng dẫn (.md) được nạp vào cuộc trò chuyện của chính bạn khi tin nhắn khớp từ khoá kích
        hoạt, hoặc khi bạn tự chọn trong Composer. Chỉ bạn thấy được skill mình tạo.
      </p>
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <Skeleton rows={3} />
      ) : (
        <div className={styles.list}>
          {sorted.map((skill) => (
            <div className={styles.row} key={skill.name}>
              <button type="button" className={styles.rowButton} onClick={() => startEdit(skill)}>
                <span className={styles.skillIcon}>
                  <Sparkles size={18} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{skill.name}</span>
                  <span className={styles.rowDescription}>{skill.description}</span>
                </span>
              </button>
              <button type="button" className={styles.deleteBtn} disabled={busy} onClick={() => handleDelete(skill.name)}>
                Xoá
              </button>
            </div>
          ))}
          {sorted.length === 0 && <div className={styles.empty}>Bạn chưa có skill nào. Bấm "+ Thêm skill mới" để tạo.</div>}
        </div>
      )}
    </section>
  )
}

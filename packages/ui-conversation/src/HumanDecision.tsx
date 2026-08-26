import { useState } from 'react'
import styles from './HumanDecision.module.css'

export interface HumanDecisionProps {
  question: string
  options: string[]
  reason?: string
  disabled?: boolean
  answered?: string
  onAnswer: (answer: string) => void
}

/**
 * Điểm tương tác cho event `human_decision` của agent.
 *
 * Component chỉ sở hữu phần trình bày. Việc tiếp tục đúng session và gửi
 * câu trả lời qua WebSocket vẫn thuộc App.tsx, nơi đang sở hữu vòng đời turn.
 */
export function HumanDecision({ question, options, reason, disabled = false, answered, onAnswer }: HumanDecisionProps) {
  const [showCustom, setShowCustom] = useState(false)
  const [customAnswer, setCustomAnswer] = useState('')
  const locked = disabled || Boolean(answered)

  const submitCustom = () => {
    const answer = customAnswer.trim()
    if (!locked && answer) onAnswer(answer)
  }

  return (
    <section className={styles.card} aria-label="Câu hỏi cần bạn quyết định">
      <div className={styles.label}>Cần bạn chọn</div>
      <div className={styles.question}>{question}</div>
      {reason && <div className={styles.reason}>{reason}</div>}

      <div className={styles.options}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={answered === option ? styles.optionSelected : styles.option}
            disabled={locked}
            onClick={() => onAnswer(option)}
          >
            {option}
          </button>
        ))}
        {!answered && (
          <button type="button" className={styles.option} disabled={disabled} onClick={() => setShowCustom(true)}>
            Khác…
          </button>
        )}
      </div>

      {showCustom && !answered && (
        <form
          className={styles.custom}
          onSubmit={(event) => {
            event.preventDefault()
            submitCustom()
          }}
        >
          <input
            autoFocus
            value={customAnswer}
            disabled={disabled}
            placeholder="Nhập câu trả lời khác"
            aria-label="Câu trả lời khác"
            onChange={(event) => setCustomAnswer(event.target.value)}
          />
          <button type="submit" disabled={disabled || !customAnswer.trim()}>
            Gửi
          </button>
        </form>
      )}

      {answered && <div className={styles.answered}>Đã trả lời: {answered}</div>}
    </section>
  )
}

// packages/ui-react/src/SlotErrorBoundary.tsx — Gap thật phát hiện qua audit
// (đối chiếu docs/agent-core-master-summary.md mục 7: "Error Boundary riêng
// từng tool-view — 1 UI lỗi không sập cả conversation" — chưa build trước
// đây). Trước fix này: nếu 1 component UI-plugin (`WebSearchCard` hoặc bất
// kỳ cái nào sau này) throw lúc render, CẢ TRANG CHAT crash trắng, không chỉ
// đúng 1 dòng tool đó.
//
// Error Boundary BẮT BUỘC phải là class component — React (kể cả bản mới
// nhất tính tới nay) chưa có hook tương đương `componentDidCatch`/
// `getDerivedStateFromError`.
//
// KHÔNG có logic tự "thử lại" phức tạp (reset theo prop đổi...) — mỗi
// `RenderSlot` gắn với đúng 1 tool-row có `key` ổn định (App.tsx), 1 tool
// call là artifact 1 lần, không cần retry giữa chừng. Giữ đơn giản (coding
// rule A6): lỗi 1 lần thì hiện fallback cho suốt vòng đời tool-row đó, đủ để
// đạt mục tiêu "không sập cả trang".
import { Component, type ReactNode } from 'react'

interface SlotErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

interface SlotErrorBoundaryState {
  hasError: boolean
}

export class SlotErrorBoundary extends Component<SlotErrorBoundaryProps, SlotErrorBoundaryState> {
  state: SlotErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

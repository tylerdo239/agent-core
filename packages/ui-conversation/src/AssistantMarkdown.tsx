// apps/web/src/AssistantMarkdown.tsx — Phase 10.4: port đúng pattern
// AssistantMarkdown thật của dsh (packages/client/ui-conversation) — câu trả
// lời assistant KHÔNG phải bubble, chảy full-width, render markdown thật
// (model trả lời có markdown thật — **in đậm**, danh sách — đã xác nhận qua
// log chat thật ở Phase 8/9, UI trước đây hiện nguyên dấu `**`/`*` thô).
//
// Dùng thư viện thật (`react-markdown`), không tự viết parser — tự chế
// markdown parser rủi ro sai edge case cao, không đáng (coding rule A6 áp
// dụng cả hướng "đừng tự xây cái đã có thư viện tốt").
//
// Bug thật user báo (2026-08): bảng markdown (cú pháp GFM `| a | b |`) model
// trả về không vẽ được thành bảng — `react-markdown` mặc định chỉ parse
// CommonMark thuần, KHÔNG hỗ trợ bảng/strikethrough/task-list (đó là phần mở
// rộng GFM, cần plugin `remark-gfm` riêng, xác nhận qua đọc docs thư viện,
// không phải bug của react-markdown). Thêm plugin + bọc `<table>` trong div
// `overflow-x: auto` riêng (coding rule chung của repo: nội dung rộng tự
// cuộn trong khung của nó, không làm cả trang cuộn ngang) — bảng nhiều cột
// trong báo cáo business-case-builder thường rộng hơn khung chat.
//
// Bug thật user báo lần 2 (2026-08): "đôi khi vẫn gặp lỗi markdown table" dù
// đã có remark-gfm ở trên — verify bằng cách parse thử qua remark-parse+
// remark-gfm trực tiếp (không qua UI): bảng cú pháp ĐÚNG (kể cả thiếu dòng
// trống trước, thiếu `|` đầu/cuối, số cột lệch giữa các hàng) parse ra
// <table> bình thường — KHÔNG phải lỗi cú pháp remark-gfm không xử lý được.
// Gốc bug thật: `text` của bubble đang STREAM được ghép trực tiếp từng
// token một (App.tsx applyStep, step 'token') và AssistantMarkdown render
// LẠI qua react-markdown ở MỌI token — trong lúc dòng phân cách bảng
// (`| --- | --- |`) đang gõ dở (vd. mới có `| --`), remark-gfm KHÔNG coi đó
// là bảng (đúng spec, dòng phân cách phải đủ cú pháp), nội dung hiện tạm
// thành đoạn văn thô với dấu `|` — nếu turn kết thúc/lỗi/bị cắt NGAY lúc đó
// (token cuối cùng rơi đúng giữa dòng phân cách), bảng đứng yên mãi mãi ở
// dạng thô vì không còn token nào tới để "hoàn thiện" cú pháp nữa. Sửa:
// KHÔNG render qua react-markdown trong lúc CÒN đang stream (`streaming`
// prop, App.tsx truyền theo streamingItemId) — hiện text thô (giữ nguyên
// xuống dòng) làm chỉ báo "đang gõ", chỉ bật markdown thật khi nội dung đã
// ĐỦ (turn xong) — đảm bảo react-markdown luôn nhận content HOÀN CHỈNH,
// không bao giờ nhận 1 bảng đang gõ dở.
// Bug thật user báo lần 3 (2026-08): vẫn gãy bảng ở content ĐÃ HOÀN CHỈNH
// (không phải đang stream — user gửi kèm log, xem chú thích data thật ở
// dưới) — khác hẳn 2 lần trước. Truy trực tiếp payload SQLite của đúng lượt
// đó, tìm ra hàng phân cách GFM (`| :--- | ... |`) model tự viết SAI:
//   | :--- | :--- | :--- | :--- :--- | :--- |
// Header có 6 cột nhưng hàng phân cách chỉ có 5 "cell", 1 cell là
// `:--- :---` (2 marker dính liền, thiếu dấu `|` ở giữa — model đếm nhầm
// cột ở bảng nhiều cột, lỗi model thật, không phải bug UI). Verify trực
// tiếp bằng remark-parse+remark-gfm: sai SỐ LƯỢNG cell so với header (dù
// mọi cell còn lại đúng cú pháp) hoặc BẤT KỲ cell nào không khớp
// `:?-+:?` đều khiến remark-gfm bỏ qua CẢ BẢNG, coi nguyên khối là 1
// paragraph thô — đúng khớp ảnh chụp màn hình user gửi (`|`/`<br>` hiện
// nguyên văn thành 1 khối chữ dài). remark-gfm bản thân không có option nào
// "khoan dung" cho trường hợp này (đã đọc source), nên sửa TRƯỚC khi đưa
// vào ReactMarkdown: dò đúng cặp "hàng trông như header" + "hàng ngay sau
// trông như phân cách" (chỉ gồm khoảng trắng/`:`/`-`/`|`, loại trừ luôn
// heading rule `---` thường không có `|`), viết lại hàng phân cách cho ĐỦ
// đúng số cell = header, cell nào sai cú pháp thay bằng `---` (chấp nhận
// mất canh lề trái/phải/giữa của riêng cell đó, đổi lấy bảng render ĐƯỢC
// thay vì cả khối văn bản thô — đánh đổi hợp lý). Không đụng dòng trong
// code fence (``` ... ```) — dò cờ inFence xuyên suốt.
//
// Bug thật user báo lần 4 (2026-08): "trong bảng tôi thấy có ký tự lạ
// '<br>-'" — model tự chèn `<br>` (HTML thô) để xuống dòng TRONG 1 cell
// bảng (cell markdown không chấp nhận xuống dòng thật, `\n` thật sẽ phá vỡ
// hàng) — đây là cách làm phổ biến, hợp lệ của model, không phải model lỗi.
// Verify trực tiếp bằng chính package `react-markdown` cài trong repo (render
// ra HTML thật qua react-dom/server, không suy đoán docs): MẶC ĐỊNH
// react-markdown KHÔNG render HTML thô (chủ đích an toàn XSS) — gặp `<br>`
// nó không strip mà hiện NGUYÊN VĂN đã escape (`&lt;br&gt;`) → đúng ký tự lạ
// user thấy. Fix: thêm `rehype-raw` (parse HTML thô thành node thật) +
// `rehype-sanitize` VỚI defaultSchema (github's allowlist chuẩn — cho qua
// br/table/img/a/strong/em/code/pre/heading..., tự động lọc sạch
// script/event-handler attribute như onerror/onclick) — đã verify cả 2
// chiều bằng cùng 1 lần render thật: `<br>` ra đúng `<br/>` (xuống dòng thật
// trong cell), còn `<script>alert()</script>` và `<img onerror=...>` vẫn bị
// chặn sạch (script bị xoá hẳn nội dung, onerror bị lọc khỏi attribute) —
// KHÔNG mở thêm lỗ XSS nào, chỉ riêng `<br>` (và các tag vô hại khác trong
// defaultSchema) mới thật sự render.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import styles from './AssistantMarkdown.module.css'

const SEPARATOR_CELL_RE = /^:?-+:?$/
const UNESCAPED_PIPE_RE = /(?<!\\)\|/

function splitRowCells(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split(UNESCAPED_PIPE_RE).map((cell) => cell.trim())
}

/** Chỉ gồm khoảng trắng/`:`/`-`/`|`, VÀ có cả `|` lẫn `-` — loại trừ heading
 * rule `---` thường (không `|`) khỏi bị coi nhầm là hàng phân cách bảng. */
function looksLikeSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false
  return /^\|?[\s:|-]+\|?$/.test(trimmed)
}

export function normalizeMarkdownTables(content: string): string {
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue }
    if (inFence) continue
    const header = lines[i]
    const separator = lines[i + 1]
    if (!header.includes('|') || !looksLikeSeparatorRow(separator)) continue
    const headerCells = splitRowCells(header)
    const separatorCells = splitRowCells(separator)
    const alreadyValid = separatorCells.length === headerCells.length && separatorCells.every((cell) => SEPARATOR_CELL_RE.test(cell))
    if (alreadyValid) continue
    const repaired = headerCells.map((_, index) => {
      const candidate = separatorCells[index]
      return candidate && SEPARATOR_CELL_RE.test(candidate) ? candidate : '---'
    })
    lines[i + 1] = `| ${repaired.join(' | ')} |`
  }
  return lines.join('\n')
}

export function AssistantMarkdown({ content, streaming }: { content: string; streaming?: boolean }) {
  if (streaming) {
    return (
      <div className={styles.markdown}>
        <span className={styles.streamingText}>{content}</span>
      </div>
    )
  }
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, defaultSchema]]}
        components={{
          table: ({ children }) => (
            <div className={styles.tableWrap}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {normalizeMarkdownTables(content)}
      </ReactMarkdown>
    </div>
  )
}

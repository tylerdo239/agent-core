// @vitest-environment jsdom
//
// Phase 10.4 deliverable: verify react-markdown THẬT render đúng — không chỉ
// tin "thư viện chắc hoạt động" vì đã cài đặt/build xanh. Model trả lời THẬT
// có markdown thật (đã xác nhận qua log chat thật Phase 8/9: "**Mức giá bán
// ra:**") — trước Phase 10.4, UI hiện nguyên dấu **/* thô, đây là bug có
// sẵn lộ ra khi đối chiếu đúng pattern dsh, không phải giả định suông.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AssistantMarkdown, normalizeMarkdownTables } from '../src/AssistantMarkdown.tsx'
import styles from '../src/AssistantMarkdown.module.css'

afterEach(cleanup)

describe('Phase 10.4 — AssistantMarkdown', () => {
  it('**in đậm** render ra <strong>, không còn dấu ** thô', () => {
    render(<AssistantMarkdown content="Giá vàng **tăng mạnh** hôm nay." />)
    const strong = screen.getByText('tăng mạnh')
    expect(strong.tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('danh sách markdown render ra <ul>/<li> thật', () => {
    render(<AssistantMarkdown content={'Các mức giá:\n\n- Mua vào: 100\n- Bán ra: 105'} />)
    const list = document.querySelector(`.${styles.markdown} ul`)
    expect(list).toBeTruthy()
    expect(list?.querySelectorAll('li').length).toBe(2)
    expect(screen.getByText(/Mua vào/).closest('li')).toBeTruthy()
  })

  it('code block render qua <pre><code>, giữ nguyên nội dung không escape sai', () => {
    render(<AssistantMarkdown content={'```\nconst x = 1\n```'} />)
    const codeBlock = document.querySelector(`.${styles.markdown} pre code`)
    expect(codeBlock?.textContent?.trim()).toBe('const x = 1')
  })

  it('text thường không có markdown vẫn render đúng nguyên văn (không throw, không mất nội dung)', () => {
    render(<AssistantMarkdown content="Xin chào, tôi có thể giúp gì cho bạn?" />)
    expect(screen.getByText('Xin chào, tôi có thể giúp gì cho bạn?')).toBeTruthy()
  })

  // Bug thật user báo (2026-08): bảng markdown (cú pháp GFM) không vẽ được
  // thành bảng — react-markdown mặc định chỉ parse CommonMark thuần, không
  // hỗ trợ bảng, cần remark-gfm. Verify render ra <table> thật, không phải
  // còn nguyên văn bản `| a | b |` thô.
  it('bảng markdown (GFM) render ra <table>/<th>/<td> thật, không còn cú pháp | | thô', () => {
    const content = ['| Tên | Giá |', '| --- | --- |', '| Cà phê | 30.000 |', '| Trà sữa | 25.000 |'].join('\n')
    render(<AssistantMarkdown content={content} />)

    const table = document.querySelector(`.${styles.markdown} table`)
    expect(table).toBeTruthy()
    expect(table?.querySelectorAll('th').length).toBe(2)
    expect(screen.getByText('Tên').tagName).toBe('TH')
    expect(screen.getByText('Cà phê').closest('td')).toBeTruthy()
    expect(screen.getByText('25.000').closest('td')).toBeTruthy()
    expect(screen.queryByText(/---/)).toBeNull()
  })

  // Bug thật user báo lần 2 (2026-08): "đôi khi vẫn gặp lỗi markdown table"
  // — gốc bug là render qua react-markdown NGAY TRONG LÚC bảng đang gõ dở
  // (token cuối rơi giữa dòng phân cách `| --- | --- |`), đứng yên mãi ở
  // dạng cú pháp thô nếu turn kết thúc/lỗi đúng lúc đó. `streaming=true`
  // phải né hẳn react-markdown — verify KHÔNG có <table>, dấu `|` còn NGUYÊN
  // VĂN (không parse dở dang thành gì khác), giữ được xuống dòng.
  it('streaming=true: hiện text thô (không qua react-markdown), dù nội dung là 1 bảng đang gõ dở', () => {
    const content = 'Bảng giá:\n| Tên | Giá |\n| --'
    render(<AssistantMarkdown content={content} streaming />)

    expect(document.querySelector(`.${styles.markdown} table`)).toBeNull()
    expect(screen.getByText(/\| Tên \| Giá \|/)).toBeTruthy()
  })

  it('streaming=false (mặc định): cùng nội dung đã ĐỦ (không còn dở dang) vẫn render đúng <table>', () => {
    const content = ['Bảng giá:', '', '| Tên | Giá |', '| --- | --- |', '| Cà phê | 30.000 |'].join('\n')
    render(<AssistantMarkdown content={content} />)

    expect(document.querySelector(`.${styles.markdown} table`)).toBeTruthy()
  })

  // Bug thật user báo lần 3 (2026-08): content ĐÃ HOÀN CHỈNH (không phải
  // đang stream) vẫn hiện nguyên văn `|`/`<br>` thay vì bảng — truy log
  // Postgres/SQLite của đúng lượt user báo, model tự viết SAI hàng phân
  // cách GFM: header 6 cột nhưng hàng phân cách chỉ 5 cell, 1 cell dính
  // liền `:--- :---` (thiếu dấu `|` giữa 2 marker). Nguyên văn dòng thật từ
  // log (rút gọn nội dung ô, giữ nguyên cấu trúc gây lỗi).
  it('bảng model viết SAI hàng phân cách (thiếu 1 dấu "|", dính 2 marker) vẫn phải render ra <table>', () => {
    const header = '| Tiêu chí | FPT | CMC | PTC | TQC | Ấn Độ |'
    const brokenSeparator = '| :--- | :--- | :--- | :--- :--- | :--- |' // 5 cell cho header 6 cột
    const row = '| Vị thế | A | B | C | D | E |'
    render(<AssistantMarkdown content={[header, brokenSeparator, row].join('\n')} />)

    const table = document.querySelector(`.${styles.markdown} table`)
    expect(table).toBeTruthy()
    expect(table?.querySelectorAll('th').length).toBe(6)
    expect(screen.getByText('TQC').tagName).toBe('TH')
    expect(screen.queryByText(/:---/)).toBeNull()
  })

  it('normalizeMarkdownTables: sửa đúng hàng phân cách thiếu cell, giữ nguyên phần còn lại của content', () => {
    const content = [
      'Trước bảng.',
      '| A | B | C |',
      '| --- | --- |', // thiếu 1 cell so với header 3 cột
      '| x | y | z |',
      'Sau bảng.',
    ].join('\n')
    const fixed = normalizeMarkdownTables(content)
    const fixedLines = fixed.split('\n')
    expect(fixedLines[2]).toBe('| --- | --- | --- |')
    expect(fixedLines[0]).toBe('Trước bảng.')
    expect(fixedLines[4]).toBe('Sau bảng.')
  })

  it('normalizeMarkdownTables: không đụng heading rule "---" thường (không có "|")', () => {
    const content = 'Đoạn 1\n\n---\n\nĐoạn 2'
    expect(normalizeMarkdownTables(content)).toBe(content)
  })

  it('normalizeMarkdownTables: không đụng bảng đã ĐÚNG cú pháp sẵn (idempotent)', () => {
    const content = ['| A | B |', '| :--- | ---: |', '| x | y |'].join('\n')
    expect(normalizeMarkdownTables(content)).toBe(content)
  })

  // Bug thật user báo lần 4 (2026-08): "trong bảng tôi thấy có ký tự lạ
  // '<br>-'" — model chèn <br> để xuống dòng trong 1 cell (cell markdown
  // không nhận \n thật). react-markdown mặc định KHÔNG render HTML thô (an
  // toàn XSS) nên hiện nguyên văn &lt;br&gt; đã escape — đúng ký tự lạ user
  // thấy. Fix: rehype-raw + rehype-sanitize (defaultSchema).
  it('<br> trong 1 cell bảng render ra xuống dòng thật, không còn hiện chữ <br> thô', () => {
    const content = ['| Điểm mạnh | Điểm yếu |', '| --- | --- |', '| - A<br>- B<br>- C | - D<br>- E |'].join('\n')
    render(<AssistantMarkdown content={content} />)

    expect(screen.queryByText(/<br>/)).toBeNull()
    const cell = document.querySelector(`.${styles.markdown} td`)
    expect(cell?.querySelectorAll('br').length).toBe(2)
  })

  // Cùng lúc xác nhận rehype-raw KHÔNG mở lỗ XSS — chỉ tag vô hại trong
  // defaultSchema (br, table, img an toàn...) mới render, script/event-
  // handler attribute (onerror/onclick...) phải bị lọc sạch.
  it('<script> và thuộc tính onerror bị chặn sạch, không lọt vào DOM/thực thi được', () => {
    const content = 'Đoạn văn <script>window.__xss = true</script> và <img src="x" onerror="window.__xss2 = true">.'
    render(<AssistantMarkdown content={content} />)

    expect(document.querySelector(`.${styles.markdown} script`)).toBeNull()
    const img = document.querySelector(`.${styles.markdown} img`)
    expect(img).toBeTruthy()
    expect(img?.getAttribute('onerror')).toBeNull()
  })
})

# Hướng dẫn — Phân tích kinh doanh

Phần này trả lời: thị trường đủ lớn không, cạnh tranh ra sao, công ty kiếm
tiền bằng cách nào, và làm sao tiếp cận khách hàng đầu tiên.

## 1. Market sizing — TAM/SAM/SOM

- **TAM (Total Addressable Market)** — tổng quy mô thị trường nếu chiếm 100%.
  Tính bằng 1 trong 2 cách, ưu tiên cách nào có số liệu thật từ `web_search`:
  - **Top-down**: lấy số liệu ngành đã công bố (báo cáo thị trường, số liệu
    chính phủ/hiệp hội ngành) — nhanh nhưng phụ thuộc chất lượng nguồn.
  - **Bottom-up**: (số lượng khách hàng tiềm năng thật) × (giá trị trung bình
    mỗi khách hàng mang lại/năm) — chậm hơn nhưng đáng tin hơn vì tự xây từ số
    liệu kiểm chứng được.
- **SAM (Serviceable Addressable Market)** — phần TAM thực tế công ty có thể
  phục vụ được (giới hạn bởi địa lý, phân khúc, quy định pháp lý).
- **SOM (Serviceable Obtainable Market)** — phần SAM công ty thực tế có thể
  chiếm được trong 1-3 năm tới, tính từ năng lực go-to-market thật (không phải
  1 con số % tuỳ tiện như "chiếm 5% thị trường" không có căn cứ).

Luôn nêu rõ phương pháp tính (top-down hay bottom-up) và nguồn số liệu đầu
vào — 1 con số TAM không rõ cách tính không có giá trị phân tích.

## 2. Cạnh tranh — 3 câu hỏi thực dụng

Đơn giản hoá Porter's 5 forces xuống 3 câu hỏi trả lời được bằng dữ liệu thật
từ `web_search`, thay vì áp khung lý thuyết đầy đủ 1 cách hình thức:

1. **Rào cản gia nhập ngành này cao hay thấp?** — vốn đầu tư ban đầu, giấy
   phép/quy định, hiệu ứng mạng lưới (network effect), chi phí chuyển đổi của
   khách hàng (switching cost).
2. **Khách hàng có quyền thương lượng mạnh không?** — số lượng nhà cung cấp
   thay thế, chi phí chuyển đổi, mức độ nhạy cảm về giá.
3. **Mức độ cạnh tranh trực tiếp ra sao?** — liệt kê 3-5 đối thủ thật (tên,
   định vị, giá, điểm mạnh/yếu quan sát được), tìm qua `web_search`, không
   liệt kê đối thủ chung chung không có tên cụ thể.

## 3. Mô hình doanh thu

Nêu rõ: nguồn thu chính (subscription/giao dịch/hoa hồng/quảng cáo/bán đứt),
đơn vị tính giá (theo user/theo usage/theo tier cố định), và điểm khác biệt so
với đối thủ đã liệt kê ở mục 2 (nếu định giá giống hệt đối thủ mà không có lý
do, đây là 1 rủi ro cần nêu trong phần Phân tích nội bộ/risk register).

## 4. Go-to-market — ngắn gọn, không lan man

Trả lời đúng 3 điều:

1. **Kênh tiếp cận khách hàng đầu tiên** — cụ thể (vd. "outbound sales tới 50
   công ty target trong ngành X", không phải "marketing đa kênh" chung chung).
2. **Chi phí ước tính cho kênh đó** — liên kết trực tiếp với CAC ở
   `references/kpi-framework.md`.
3. **Mốc thành công đo được trong 90 ngày đầu** — 1 con số cụ thể, không phải
   mục tiêu định tính ("có traction tốt").

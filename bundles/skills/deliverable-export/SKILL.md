---
name: deliverable-export
description: Xuất kết quả phân tích thành tệp bàn giao được trong workspace — bảng tính Excel nhiều sheet có định dạng và công thức, CSV/Parquet sạch, biểu đồ ảnh, hoặc báo cáo Markdown kèm số liệu. Dùng khi người dùng muốn nhận lại một tệp để tải về, gửi đi hay mở bằng Excel, thay vì chỉ đọc kết quả trong hội thoại.
drivers: rlm
---

# deliverable-export — biến kết quả thành tệp bàn giao được

Người dùng tải dữ liệu lên rồi thường muốn nhận lại **một tệp**, không phải
một đoạn văn. Skill này lo chặng cuối đó.

## Công cụ có sẵn trong sandbox

`openpyxl` (Excel), `pandas` (`to_excel`/`to_csv`/`to_parquet`),
`matplotlib`/`seaborn` (ảnh biểu đồ), `pyarrow`. **Không có** `python-docx`
hay thư viện PDF — đừng hứa xuất `.docx`/`.pdf`; nếu người dùng cần định
dạng đó, nói thẳng là hiện chưa hỗ trợ và đề xuất `.xlsx` hoặc `.md`.

## Kỷ luật

1. **Ghi vào workspace**, đặt tên tệp nói được nội dung và mốc thời gian
   (`doanh-thu-theo-thang-2026-09.xlsx`), không phải `output.xlsx`.
2. **Nêu đường dẫn tệp** trong câu trả lời — người dùng phải biết tải ở đâu.
3. **Excel nhiều sheet có trật tự**: sheet đầu là tóm tắt đọc được ngay,
   các sheet sau là dữ liệu chi tiết. Đặt tiêu đề cột rõ ràng, định dạng số
   đúng kiểu (tiền tệ, phần trăm, ngày), cố định hàng tiêu đề.
4. **Số trong tệp phải khớp số trong câu trả lời.** Sinh tệp từ chính
   DataFrame đã dùng để kết luận, đừng gõ lại bằng tay.
5. **Không nói đã xuất xong trước khi ghi xong.** Kiểm tra tệp tồn tại và có
   kích thước hợp lý rồi mới báo.

## Trước khi xuất

Hỏi (hoặc suy ra) ba điều: người dùng sẽ **mở bằng gì**, cần **mức chi tiết
nào**, và có cần **dữ liệu thô kèm theo** hay chỉ cần bảng đã tổng hợp.

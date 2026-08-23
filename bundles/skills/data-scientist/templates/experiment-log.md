# Nhật ký Experiment — {tên dự án}

_Chỉ ghi nối tiếp. Ghi lại mọi run trước khi thử ý tưởng tiếp theo. Giữ cố định
split design và metric; chỉ thay đổi khi đã ghi rõ lý do._

**Thiết kế validation:** {loại split, số fold, chính sách holdout}
**Metric chính:** {metric} · **Dummy baseline:** {score} · **Linear baseline:** {score ± std}

---

## Run {N} — {ngày} — {ý tưởng trong một dòng}

- **Dữ liệu:** {file/version, số row, filter}
- **Feature:** {thêm/bỏ so với run trước}
- **Model và params:** {}
- **Kết quả CV:** {metric mean ± std qua các fold}
- **Xác nhận leakage:** {đã chạy checklist? probe nào?}
- **Điều học được:** {một dòng — giữ hay bỏ ý tưởng}

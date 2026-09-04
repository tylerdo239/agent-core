---
name: skill-creator
description: Thiết kế và viết một skill mới cho agent-core — chọn phạm vi không chồng lấn skill sẵn có, viết description để bộ định tuyến chọn đúng, khai `drivers` khớp năng lực loop, và tách phần chi tiết xuống resources thay vì nhồi hết vào một tệp. Dùng khi người dùng muốn tạo skill riêng, sửa skill đang có, hoặc hỏi vì sao skill của họ không được kích hoạt.
triggers: tạo skill, viết skill, sửa skill, skill mới
---

# skill-creator — viết một skill được chọn đúng lúc

Một skill là **gói hướng dẫn tĩnh**, không phải tool. Nó không tự làm gì cả;
nó thay đổi cách model làm việc trong lượt đó.

## Cấu trúc

```
<tên-skill>/
  SKILL.md            frontmatter + hướng dẫn ngắn gọn
  references/         chi tiết sâu, đọc khi cần
  checklists/ scripts/ templates/ assets/
```

Frontmatter:

| Khoá | Ý nghĩa |
|---|---|
| `name` | tên duy nhất, kebab-case |
| `description` | **quan trọng nhất** — xem bên dưới |
| `drivers` | `default`, `rlm`, hoặc cả hai (`default, rlm`). Bỏ trống = mọi loop |
| `triggers` | cụm từ kích hoạt tất định, phân tách bằng dấu phẩy |
| `user-invocable` | `false` nếu chỉ dùng nội bộ |

## `description` quyết định skill có được chọn hay không

Bộ định tuyến chỉ nhìn thấy `name` + `description`, không thấy phần thân.
Description phải trả lời được **"khi nào dùng"**, không chỉ **"đây là gì"**.

- ✅ *"…Dùng khi người dùng cần X, hoặc khi Y xảy ra."*
- ❌ *"Skill phân tích dữ liệu nâng cao."* — không phân biệt được với 5 skill khác.

Viết xong hãy tự hỏi: nếu đặt cạnh những skill hiện có, mô tả này có **chồng
lấn** cái nào không? Chồng lấn là nguyên nhân số một khiến router chọn nhầm.
Chồng lấn nhiều thì nên **gộp**, không nên thêm skill mới.

## `drivers` phải khớp năng lực loop

`default` chỉ có `web_search` và `database_query` — **không chạy được code,
không đọc được tệp**. `rlm` có sandbox Python và workspace. Skill bảo model
"đọc dataset rồi chạy pandas" mà khai `drivers: default` là đưa cho model
hướng dẫn nó không có cách nào thực hiện — model sẽ tuyên bố đang làm rồi
kết thúc lượt mà không làm gì.

## `triggers` — ít mà chính xác

Trigger khớp theo cụm từ trên tin nhắn người dùng. Cụm nhiều từ, đặc thù thì
an toàn; từ đơn phổ thông (`phân tích`, `dữ liệu`) sẽ kích hoạt bừa ở mọi
cuộc hội thoại. Không chắc thì để trống và dựa vào description.

## Thân SKILL.md

Ngắn. Nêu quy trình và ranh giới không được vượt. Chi tiết dài (bảng tra,
mẫu code, danh sách kiểm) đẩy xuống `references/` rồi trỏ tới bằng bảng
"đọc khi nào" — model nạp thêm bằng `read_skill_resource` đúng lúc cần,
không tốn ngữ cảnh cho phần chưa dùng tới.

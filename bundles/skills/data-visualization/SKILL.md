---
name: data-visualization
description: Tạo trực quan hóa dữ liệu hiệu quả bằng Python (matplotlib, seaborn, plotly). Sử dụng khi xây dựng biểu đồ, chọn loại biểu đồ phù hợp cho tập dữ liệu, tạo hình minh họa chất lượng xuất bản hoặc áp dụng các nguyên tắc thiết kế như khả năng tiếp cận và lý thuyết màu sắc.
user-invocable: false
---

# Skill trực quan hóa dữ liệu

Hướng dẫn chọn biểu đồ, các mẫu mã trực quan hóa Python, nguyên tắc thiết kế và cân nhắc về khả năng tiếp cận để tạo trực quan hóa dữ liệu hiệu quả.

## Hướng dẫn chọn biểu đồ

### Chọn theo mối quan hệ dữ liệu

| Nội dung cần thể hiện | Biểu đồ phù hợp nhất | Phương án khác |
|---|---|---|
| **Xu hướng theo thời gian** | Biểu đồ đường | Biểu đồ miền (khi thể hiện tích lũy hoặc cơ cấu) |
| **So sánh giữa các danh mục** | Biểu đồ cột dọc | Cột ngang (nhiều danh mục), biểu đồ lollipop |
| **Xếp hạng** | Biểu đồ cột ngang | Dot plot, slope chart (so sánh hai kỳ) |
| **Cơ cấu phần-trên-tổng** | Biểu đồ cột chồng | Treemap (phân cấp), waffle chart |
| **Cơ cấu theo thời gian** | Biểu đồ miền chồng | Cột chồng 100% (khi tập trung vào tỷ trọng) |
| **Phân phối** | Histogram | Box plot (so sánh nhóm), violin plot, strip plot |
| **Tương quan (2 biến)** | Scatter plot | Bubble chart (dùng kích thước cho biến thứ ba) |
| **Tương quan (nhiều biến)** | Heatmap (ma trận tương quan) | Pair plot |
| **Mẫu hình địa lý** | Bản đồ choropleth | Bubble map, hex map |
| **Luồng / quy trình** | Biểu đồ Sankey | Funnel chart (các giai đoạn tuần tự) |
| **Mạng lưới quan hệ** | Network graph | Chord diagram |
| **Hiệu suất so với mục tiêu** | Bullet chart | Gauge (chỉ cho một KPI) |
| **Nhiều KPI cùng lúc** | Small multiples | Dashboard với các biểu đồ riêng |

### Khi KHÔNG nên dùng một số loại biểu đồ

- **Biểu đồ tròn**: Tránh dùng trừ khi có dưới 6 danh mục và tỷ lệ chính xác ít quan trọng hơn so sánh tương đối. Con người khó so sánh góc; hãy dùng biểu đồ cột.
- **Biểu đồ 3D**: Không dùng. Chúng làm sai lệch cảm nhận mà không bổ sung thông tin.
- **Biểu đồ hai trục**: Dùng thận trọng vì có thể ngụ ý tương quan sai. Nếu dùng, ghi nhãn rõ cả hai trục.
- **Cột chồng với nhiều danh mục**: Khó so sánh các phần ở giữa. Dùng small multiples hoặc cột nhóm.
- **Biểu đồ donut**: Nhỉnh hơn biểu đồ tròn nhưng có cùng vấn đề nền tảng. Chỉ nên dùng để hiển thị một KPI.

## Mẫu mã trực quan hóa bằng Python

### Thiết lập và phong cách

```python
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
import pandas as pd
import numpy as np

# Thiết lập phong cách chuyên nghiệp
plt.style.use('seaborn-v0_8-whitegrid')
plt.rcParams.update({
    'figure.figsize': (10, 6),
    'figure.dpi': 150,
    'font.size': 11,
    'axes.titlesize': 14,
    'axes.titleweight': 'bold',
    'axes.labelsize': 11,
    'xtick.labelsize': 10,
    'ytick.labelsize': 10,
    'legend.fontsize': 10,
    'figure.titlesize': 16,
})

# Bảng màu thân thiện với người mù màu
PALETTE_CATEGORICAL = ['#4C72B0', '#DD8452', '#55A868', '#C44E52', '#8172B3', '#937860']
PALETTE_SEQUENTIAL = 'YlOrRd'
PALETTE_DIVERGING = 'RdBu_r'
```

### Biểu đồ đường (chuỗi thời gian)

```python
fig, ax = plt.subplots(figsize=(10, 6))

for label, group in df.groupby('category'):
    ax.plot(group['date'], group['value'], label=label, linewidth=2)

ax.set_title('Xu hướng chỉ số theo danh mục', fontweight='bold')
ax.set_xlabel('Ngày')
ax.set_ylabel('Giá trị')
ax.legend(loc='upper left', frameon=True)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

# Định dạng ngày trên trục x
fig.autofmt_xdate()

plt.tight_layout()
plt.savefig('trend_chart.png', dpi=150, bbox_inches='tight')
```

### Biểu đồ cột (so sánh)

```python
fig, ax = plt.subplots(figsize=(10, 6))

# Sắp xếp theo giá trị để dễ đọc
df_sorted = df.sort_values('metric', ascending=True)

bars = ax.barh(df_sorted['category'], df_sorted['metric'], color=PALETTE_CATEGORICAL[0])

# Thêm nhãn giá trị
for bar in bars:
    width = bar.get_width()
    ax.text(width + 0.5, bar.get_y() + bar.get_height()/2,
            f'{width:,.0f}', ha='left', va='center', fontsize=10)

ax.set_title('Chỉ số theo danh mục (đã xếp hạng)', fontweight='bold')
ax.set_xlabel('Giá trị chỉ số')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

plt.tight_layout()
plt.savefig('bar_chart.png', dpi=150, bbox_inches='tight')
```

### Histogram (phân phối)

```python
fig, ax = plt.subplots(figsize=(10, 6))

ax.hist(df['value'], bins=30, color=PALETTE_CATEGORICAL[0], edgecolor='white', alpha=0.8)

# Thêm đường trung bình và trung vị
mean_val = df['value'].mean()
median_val = df['value'].median()
ax.axvline(mean_val, color='red', linestyle='--', linewidth=1.5, label=f'Trung bình: {mean_val:,.1f}')
ax.axvline(median_val, color='green', linestyle='--', linewidth=1.5, label=f'Trung vị: {median_val:,.1f}')

ax.set_title('Phân phối giá trị', fontweight='bold')
ax.set_xlabel('Giá trị')
ax.set_ylabel('Tần suất')
ax.legend()
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

plt.tight_layout()
plt.savefig('histogram.png', dpi=150, bbox_inches='tight')
```

### Heatmap

```python
fig, ax = plt.subplots(figsize=(10, 8))

# Pivot dữ liệu sang định dạng heatmap
pivot = df.pivot_table(index='row_dim', columns='col_dim', values='metric', aggfunc='sum')

sns.heatmap(pivot, annot=True, fmt=',.0f', cmap='YlOrRd',
            linewidths=0.5, ax=ax, cbar_kws={'label': 'Giá trị chỉ số'})

ax.set_title('Chỉ số theo chiều hàng và chiều cột', fontweight='bold')
ax.set_xlabel('Chiều cột')
ax.set_ylabel('Chiều hàng')

plt.tight_layout()
plt.savefig('heatmap.png', dpi=150, bbox_inches='tight')
```

### Biểu đồ small multiples

```python
categories = df['category'].unique()
n_cats = len(categories)
n_cols = min(3, n_cats)
n_rows = (n_cats + n_cols - 1) // n_cols

fig, axes = plt.subplots(n_rows, n_cols, figsize=(5*n_cols, 4*n_rows), sharex=True, sharey=True)
axes = axes.flatten() if n_cats > 1 else [axes]

for i, cat in enumerate(categories):
    ax = axes[i]
    subset = df[df['category'] == cat]
    ax.plot(subset['date'], subset['value'], color=PALETTE_CATEGORICAL[i % len(PALETTE_CATEGORICAL)])
    ax.set_title(cat, fontsize=12)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

# Ẩn các subplot trống
for j in range(i+1, len(axes)):
    axes[j].set_visible(False)

fig.suptitle('Xu hướng theo danh mục', fontsize=14, fontweight='bold', y=1.02)
plt.tight_layout()
plt.savefig('small_multiples.png', dpi=150, bbox_inches='tight')
```

### Hàm hỗ trợ định dạng số

```python
def format_number(val, format_type='number'):
    """Định dạng số dùng cho nhãn biểu đồ."""
    if format_type == 'currency':
        if abs(val) >= 1e9:
            return f'${val/1e9:.1f}B'
        elif abs(val) >= 1e6:
            return f'${val/1e6:.1f}M'
        elif abs(val) >= 1e3:
            return f'${val/1e3:.1f}K'
        else:
            return f'${val:,.0f}'
    elif format_type == 'percent':
        return f'{val:.1f}%'
    elif format_type == 'number':
        if abs(val) >= 1e9:
            return f'{val/1e9:.1f}B'
        elif abs(val) >= 1e6:
            return f'{val/1e6:.1f}M'
        elif abs(val) >= 1e3:
            return f'{val/1e3:.1f}K'
        else:
            return f'{val:,.0f}'
    return str(val)

# Dùng với bộ định dạng trục
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: format_number(x, 'currency')))
```

### Biểu đồ tương tác với Plotly

```python
import plotly.express as px
import plotly.graph_objects as go

# Biểu đồ đường tương tác đơn giản
fig = px.line(df, x='date', y='value', color='category',
              title='Xu hướng chỉ số tương tác',
              labels={'value': 'Giá trị chỉ số', 'date': 'Ngày'})
fig.update_layout(hovermode='x unified')
fig.write_html('interactive_chart.html')
fig.show()

# Scatter plot tương tác có dữ liệu khi di chuột
fig = px.scatter(df, x='metric_a', y='metric_b', color='category',
                 size='size_metric', hover_data=['name', 'detail_field'],
                 title='Phân tích tương quan')
fig.show()
```

## Nguyên tắc thiết kế

### Màu sắc

- **Dùng màu có mục đích**: Màu phải mã hóa dữ liệu, không chỉ để trang trí
- **Làm nổi bật câu chuyện**: Dùng một màu nhấn sáng cho insight chính; chuyển phần còn lại sang xám
- **Dữ liệu tuần tự**: Dùng dải chuyển sắc một màu (nhạt đến đậm) cho giá trị có thứ tự
- **Dữ liệu phân kỳ**: Dùng dải hai màu với điểm giữa trung tính khi dữ liệu có tâm mang ý nghĩa
- **Dữ liệu phân loại**: Dùng các màu khác biệt, tối đa 6-8 màu trước khi gây rối
- **Tránh chỉ dùng đỏ/xanh lá**: Khoảng 8% nam giới bị mù màu đỏ-xanh lá. Ưu tiên cặp xanh dương/cam

### Kiểu chữ

- **Tiêu đề nêu insight**: "Doanh thu tăng 23% YoY" tốt hơn "Doanh thu theo tháng"
- **Phụ đề bổ sung ngữ cảnh**: Khoảng ngày, bộ lọc đã áp dụng, nguồn dữ liệu
- **Nhãn trục dễ đọc**: Tránh xoay 90 độ; thay vào đó hãy rút ngắn hoặc xuống dòng
- **Nhãn dữ liệu tăng độ chính xác**: Dùng ở các điểm chính, không phải mọi cột
- **Chú thích tạo điểm nhấn**: Làm nổi bật các điểm cụ thể bằng chú thích văn bản

### Bố cục

- **Giảm chi tiết thừa**: Loại bỏ đường lưới, viền và nền không truyền tải thông tin
- **Sắp xếp có ý nghĩa**: Sắp danh mục theo giá trị, không theo bảng chữ cái, trừ khi có thứ tự tự nhiên (tháng, giai đoạn)
- **Tỷ lệ khung hình phù hợp**: Chuỗi thời gian nên rộng hơn cao (3:1 đến 2:1); biểu đồ so sánh có thể vuông hơn
- **Khoảng trắng là cần thiết**: Không dồn ép các biểu đồ; để mỗi trực quan có đủ không gian

### Độ chính xác

- **Biểu đồ cột bắt đầu từ 0**: Luôn luôn. Cột từ 95 đến 100 sẽ phóng đại chênh lệch 5%
- **Biểu đồ đường có thể có đường cơ sở khác 0**: Khi phạm vi biến thiên có ý nghĩa
- **Thang đo nhất quán giữa các panel**: Khi so sánh nhiều biểu đồ, dùng cùng phạm vi trục
- **Thể hiện độ bất định**: Dùng thanh sai số, khoảng tin cậy hoặc khoảng giá trị khi dữ liệu không chắc chắn
- **Ghi nhãn trục**: Không để người đọc phải đoán ý nghĩa của các con số

## Cân nhắc về khả năng tiếp cận

### Mù màu

- Không chỉ dựa vào màu để phân biệt các chuỗi dữ liệu
- Thêm họa tiết tô, kiểu đường khác nhau (liền, gạch, chấm) hoặc nhãn trực tiếp
- Kiểm tra bằng trình mô phỏng mù màu (ví dụ: Coblis, Sim Daltonism)
- Dùng bảng màu thân thiện với người mù màu: `sns.color_palette("colorblind")`

### Trình đọc màn hình

- Thêm văn bản thay thế mô tả phát hiện chính của biểu đồ
- Cung cấp bảng dữ liệu thay thế bên cạnh trực quan
- Dùng tiêu đề và nhãn có ngữ nghĩa

### Khả năng tiếp cận nói chung

- Đảm bảo độ tương phản giữa thành phần dữ liệu và nền
- Cỡ chữ tối thiểu 10pt cho nhãn, 12pt cho tiêu đề
- Tránh chỉ truyền đạt thông tin qua vị trí không gian; hãy thêm nhãn
- Cân nhắc khi in: biểu đồ có dùng được ở chế độ đen trắng không?

### Checklist khả năng tiếp cận

Trước khi chia sẻ một trực quan:
- [ ] Biểu đồ vẫn hiểu được khi không có màu (phân biệt chuỗi bằng họa tiết, nhãn hoặc kiểu đường)
- [ ] Văn bản dễ đọc ở mức thu phóng tiêu chuẩn
- [ ] Tiêu đề mô tả insight, không chỉ mô tả dữ liệu
- [ ] Các trục có nhãn và đơn vị
- [ ] Chú giải rõ ràng và không che dữ liệu
- [ ] Có ghi nguồn dữ liệu và khoảng ngày

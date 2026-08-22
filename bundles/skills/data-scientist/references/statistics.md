# Suy luận thống kê

Tiêu chuẩn cho luồng Inquire: chọn test, kiểm tra assumption, đo effect,
định lượng uncertainty và xác định khi nào causal claim được phép.

## Chọn test

Xác định loại câu hỏi, loại outcome và design độc lập hay paired.

| Design/outcome | Test | Effect size |
|---|---|---|
| 2 nhóm độc lập, continuous gần normal | Welch's t-test | Cohen's d + CI |
| 2 nhóm độc lập, skew/ordinal | Mann–Whitney U | rank-biserial r |
| 2 nhóm, binary | two-proportion z/chi-square; Fisher nếu expected cell < 5 | difference in proportion + CI, relative risk |
| Paired continuous | paired t; Wilcoxon nếu skew | paired d |
| Paired binary | McNemar | odds ratio |
| 3+ nhóm continuous | Welch ANOVA; Kruskal–Wallis nếu skew | eta-squared |

Sau omnibus test có ý nghĩa, chạy pairwise post-hoc cùng correction như Tukey
HSD hoặc Holm. Với relationship: Pearson cho continuous tuyến tính, Spearman
cho monotonic/outlier; linear regression cho continuous outcome; logistic cho
binary; Poisson/negative binomial cho count; Kaplan–Meier/log-rank/Cox cho
time-to-event.

## Kiểm tra assumption

Kiểm tra bằng code. Với n hàng trăm trở lên, CLT thường bảo vệ t-test trước
non-normality; quan tâm heavy skew và outlier hơn Shapiro p-value. Welch xử lý
unequal variance. **Independence là assumption nguy hiểm nhất và không test nào
tự phát hiện:** row lặp theo user hoặc cluster theo store cần aggregate,
mixed-effect hoặc cluster-robust model. Với regression, xem residual vs fitted,
heteroscedasticity, Cook's distance và VIF. Khi assumption không đạt và không
có phương án sạch, dùng bootstrap có seed để tạo CI cho statistic cần thiết.

## Effect size và confidence interval

P-value trả lời “có thể là noise không?”, không trả lời “có đáng quan tâm
không?”. Luôn báo effect theo đơn vị kinh doanh trước, chẳng hạn conversion
+1,8 percentage point, 95% CI [0,9; 2,7], rồi mới standardized effect. CI hẹp
chứa 0 có thể kết luận không có effect đủ lớn để hành động; CI rộng nghĩa là
underpowered và chưa học được nhiều — không được đánh đồng hai trường hợp.

## Multiple comparisons

Mỗi lần nhìn thêm làm tăng false positive. Với confirmatory analysis, correction
theo family bằng Holm-Bonferroni hoặc Benjamini–Hochberg FDR. Với exploratory
analysis, có thể không correction nhưng phải đánh dấu mọi phát hiện là tạo giả
thuyết, không dùng p-value chưa correction như xác nhận. Với A/B test, cố định
stopping rule trước hoặc dùng sequential method.

## Power và sample size

Tính sample size trước experiment từ alpha, power, baseline rate và minimum
effect đáng quan tâm, thường bằng `statsmodels.stats.power`. Cách trình bày MDE
hữu ích hơn: với traffic hiện có, effect nhỏ nhất có thể phát hiện là bao nhiêu.
Với skew metric, clustered unit hoặc sequential design, mô phỏng dữ liệu theo
effect giả định, chạy đúng analysis dự kiến khoảng 1.000 lần và đếm tỷ lệ p < α.

## Causality

Thang bằng chứng:

1. **Randomized experiment:** được phép nói “gây ra” sau khi kiểm tra balance,
   interference và differential dropout.
2. **Quasi-experiment:** difference-in-differences, regression discontinuity
   hoặc instrumental variable; chỉ dùng causal language khi nêu design và chứng
   minh assumption như parallel trend.
3. **Observational có điều chỉnh confounder:** chỉ nói “có liên hệ sau khi điều
   chỉnh X/Y/Z”, đồng thời nêu unmeasured confounding.
4. **Raw correlation:** chỉ được nói “có liên hệ với”.

Confounding là giải thích mặc định. Không control mediator trên causal path và
không condition collider vì có thể xóa effect thật hoặc tạo association giả.
Audit báo cáo cho các từ “gây ra”, “thúc đẩy”, “dẫn đến”, “bởi vì”, “tác động”;
mọi trường hợp thiếu bằng chứng mức 1–2 phải hạ thành “có liên hệ với”.

## Báo cáo

Trong một câu tự chứa, nêu group và n, metric của từng group, difference theo
đơn vị kinh doanh, 95% CI, test, exact p-value, effect size và diễn giải so với
success bar. Không dùng “marginally significant” hay báo “significant” mà thiếu
effect size. Phân biệt comparison pre-planned với exploratory.

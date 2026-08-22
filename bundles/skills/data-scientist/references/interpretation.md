# Diễn giải: điều gì chi phối model và điều gì chi phối outcome

“Điều gì thúc đẩy X?” che giấu hai câu hỏi: *model dùng gì?* và *điều gì thực
sự gây ra outcome?*. Câu đầu là model explanation; câu sau là causality theo
`references/statistics.md`. Không trộn chúng trong suy nghĩ hay báo cáo.

## Công cụ theo thứ tự ưu tiên

- **Permutation importance trên validation data:** mặc định cho câu hỏi model
  dùng gì; model-agnostic và phản ánh generalization. Feature correlated chia
  credit không ổn định nên có thể cần permute theo nhóm.
- **Coefficient:** với linear/logistic model, coefficient kèm CI dễ giải thích
  khi feature đã standardize và kiểm tra multicollinearity/VIF.
- **SHAP:** hữu ích cho local explanation và debug prediction bất ngờ; không
  ném nguyên beeswarm plot vào executive report mà phải chuyển thành insight.
- **Partial dependence/ICE:** cho biết shape như threshold, saturation hay
  U-curve; thường actionable hơn ranking.
- **Impurity importance (`feature_importances_`):** chỉ dùng sanity check nội
  bộ vì thiên vị feature cardinality cao và tính trên training data.

## Sanity pass

- Bất ngờ là bug cho đến khi được chứng minh là insight. Feature đứng đầu ngoài
  dự kiến có khả năng là leakage, artifact rồi mới đến discovery thật; điều tra
  theo thứ tự đó.
- Importance không cho biết direction; ghép ranking với direction và shape.
- Importance không đồng nghĩa lever. “Tenure quan trọng” không có nghĩa có thể
  tăng tenure để giảm churn.
- Kiểm tra stability qua fold, seed và time period; ranking thay đổi mạnh phải
  được báo là không ổn định.
- Diễn giải theo đơn vị kinh doanh: thay vì “SHAP +0,37”, nói thay đổi feature
  từ mức A sang B liên hệ với thay đổi risk bao nhiêu percentage point trong
  range dữ liệu quan sát.

## Global và local explanation

Global explanation mô tả hành vi model nói chung; local explanation trả lời
tại sao một row có score cụ thể. Local explanation không phải nguyên nhân thật
và không nên được dùng làm causal recommendation. Với case-level decision,
kiểm tra feature value, contribution và counterfactual có khả thi về nghiệp vụ.

## Từ association đến causality

Model explanation chỉ nói model tận dụng pattern nào. Muốn nói feature gây ra
outcome cần randomized experiment hoặc causal design được bảo vệ. Với dữ liệu
quan sát, dùng cách viết “có liên hệ với sau khi điều chỉnh X/Y/Z”, nêu
confounder có thể còn lại và đề xuất experiment có thể xác nhận.

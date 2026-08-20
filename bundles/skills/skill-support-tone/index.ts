// bundles/skills/skill-support-tone — ví dụ #1 cho seam ctx.skills.
//
// Kích hoạt khi tin nhắn user có dấu hiệu khiếu nại/sự cố — chèn hướng dẫn
// giọng văn hỗ trợ khách hàng chuẩn (xác nhận vấn đề, hỏi rõ thông tin cần
// thiết, đề xuất bước tiếp theo) vào system prompt CHỈ CHO lượt đó, không
// làm phình system prompt cố định cho mọi lượt hội thoại khác.
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/skill.ts'

export const inject = ['skills']

export const apply = (ctx: Context) => {
  ctx.skills.register({
    name: 'support-tone',
    description: 'Chuẩn hoá giọng văn khi user báo lỗi/khiếu nại/sự cố.',
    triggers: ['khiếu nại', 'sự cố', 'lỗi mạng', 'không dùng được', 'không kết nối được', 'báo lỗi'],
    instructions:
      'Người dùng có vẻ đang gặp sự cố hoặc muốn khiếu nại. Trả lời theo đúng thứ tự: ' +
      '(1) xác nhận đã hiểu đúng vấn đề, (2) hỏi rõ thông tin còn thiếu nếu cần ' +
      '(vd. mã khách hàng, thời điểm xảy ra), (3) đề xuất bước xử lý tiếp theo cụ thể. ' +
      'Giữ giọng văn lịch sự, ngắn gọn, không hứa hẹn điều nằm ngoài khả năng xử lý thật.',
  })

  ctx.logger('skill-support-tone').info('activated')
}

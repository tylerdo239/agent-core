"""Self-test cho line_reader (chạy qua tests/rlm-line-reader.test.ts).

Repo không có hạ tầng test Python, nên file này tự chấm và trả exit code —
vitest spawn nó y như tests/sandbox-cancellation.test.ts spawn worker thật.
"""
import io, os, sys, time, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from line_reader import LineReader, LineReaderTimeout

fails = []
def check(name, cond):
    print(('  OK  ' if cond else ' FAIL ') + name)
    if not cond: fails.append(name)

# 1. đọc tuần tự, xen kẽ chờ-vô-hạn và chờ-có-hạn (đúng cảnh worker thật)
r = LineReader(io.BytesIO(b'lenh-1\ntra-loi\nlenh-2\n'))
check('vòng lặp chính lấy dòng 1', r.read_line() == 'lenh-1\n')
check('cầu nối lồng lấy dòng 2', r.read_line(timeout=1, what='llm reply') == 'tra-loi\n')
check('vòng lặp lấy tiếp dòng 3', r.read_line() == 'lenh-2\n')
check('EOF trả None', r.read_line(timeout=1) is None)

# 2. quá giờ -> raise, KHÔNG nằm im (đây là bug đang vá)
class NeverEnds(io.RawIOBase):
    def readline(self, *a): time.sleep(60); return b''
r2 = LineReader(NeverEnds())
t0 = time.time()
try:
    r2.read_line(timeout=0.3, what='host LLM reply')
    check('quá giờ phải raise', False)
except LineReaderTimeout as e:
    check('quá giờ raise LineReaderTimeout', True)
    check('thông điệp nói rõ đang chờ CÁI GÌ', 'host LLM reply' in str(e))
    check('raise đúng lúc, không chờ lâu hơn', 0.25 < time.time() - t0 < 2)

# 3. dòng tới muộn vẫn nhận được (không mất dữ liệu sau một lần timeout)
pr, pw = os.pipe()
r3 = LineReader(os.fdopen(pr, 'rb', 0))
try:
    r3.read_line(timeout=0.2, what='x'); check('lần đầu phải timeout', False)
except LineReaderTimeout: check('lần đầu timeout đúng', True)
threading.Timer(0.1, lambda: (os.write(pw, b'muon-nhung-den\n'), os.close(pw))).start()
check('dòng tới muộn vẫn nhận đủ', r3.read_line(timeout=2) == 'muon-nhung-den\n')

print('\nKẾT QUẢ:', 'TẤT CẢ PASS' if not fails else f'{len(fails)} FAIL: {fails}')
sys.exit(1 if fails else 0)

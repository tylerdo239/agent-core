"""Một đường đọc DUY NHẤT cho stdin của worker, có timeout.

Vì sao cần: trước đây worker đọc stdin ở hai chỗ — vòng lặp lệnh chính và
cầu nối host (`sys.stdin.readline()` lồng bên trong khi chờ model/tool trả
lời). Cả hai đều là `readline()` CHẶN VÔ HẠN. Turn treo 25+ phút mà không
throw, không event, worker `utime=0` chính là cảnh này: worker nằm chờ một
dòng không bao giờ tới, và không lớp timeout nào của RLM phủ được nó
(`max_timeout` chỉ được kiểm giữa các iteration; `cell_timeout` chỉ phủ ô
REPL).

`select()` trần trên `sys.stdin` KHÔNG dùng được: TextIOWrapper có bộ đệm
riêng, dòng đã nằm trong bộ đệm thì `select()` trên file descriptor không
thấy gì và sẽ báo timeout oan. Nên toàn bộ việc đọc dồn về một thread duy
nhất đọc thẳng byte stream, rồi phát lại qua Queue — Queue.get() có timeout
thật, không phụ thuộc bộ đệm nào.
"""

from __future__ import annotations

import queue
import threading
from typing import IO


class LineReaderTimeout(Exception):
    """Hết thời gian chờ một dòng. Kèm nhãn để biết đang chờ cái gì."""

    def __init__(self, what: str, timeout: float):
        super().__init__(f"timed out after {timeout:.1f}s waiting for {what}")
        self.what = what
        self.timeout = timeout


class LineReader:
    """Đọc từng dòng từ một binary stream trong thread nền, phát qua Queue."""

    def __init__(self, stream: IO[bytes], encoding: str = "utf-8"):
        self._stream = stream
        self._encoding = encoding
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._thread = threading.Thread(target=self._pump, name="stdin-reader", daemon=True)
        self._closed = False
        self._thread.start()

    def _pump(self) -> None:
        try:
            for raw in iter(self._stream.readline, b""):
                self._queue.put(raw.decode(self._encoding, errors="replace"))
        except Exception:
            pass
        finally:
            # None = EOF; đặt sau cùng nên mọi dòng đã đọc được vẫn tới tay
            # người tiêu thụ trước khi họ thấy EOF.
            self._queue.put(None)
            self._closed = True

    def read_line(self, timeout: float | None = None, what: str = "input") -> str | None:
        """Trả dòng kế tiếp, None nếu EOF. Raise LineReaderTimeout nếu quá giờ.

        `timeout=None` = chờ vô hạn, dùng cho vòng lặp lệnh chính (worker rảnh
        giữa các turn thì nằm chờ là đúng). Cầu nối host thì LUÔN truyền
        timeout: chờ vô hạn ở đó chính là bug đang vá.
        """
        if timeout is None:
            return self._queue.get()
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            raise LineReaderTimeout(what, timeout) from None

    @property
    def closed(self) -> bool:
        return self._closed

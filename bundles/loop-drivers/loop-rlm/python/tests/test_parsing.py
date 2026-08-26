from __future__ import annotations

import unittest

from rlm.utils.parsing import find_code_blocks


class ReplParsingTests(unittest.TestCase):
    def test_repairs_json_style_tail_after_answer_assignment(self) -> None:
        response = '''repl
```python
answer["content"] = "done"
  },
  "ready": True
```
'''
        self.assertEqual(
            find_code_blocks(response),
            ['answer["content"] = "done"\nanswer["ready"] = True'],
        )

    def test_does_not_rewrite_unrelated_invalid_python(self) -> None:
        response = '''```repl
payload = {"content": "not an answer"}
  },
  "ready": True
```'''
        self.assertEqual(
            find_code_blocks(response),
            ['payload = {"content": "not an answer"}\n  },\n  "ready": True'],
        )


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

from contextlib import contextmanager
import unittest

from rlm.core.rlm import RLM
from rlm.core.types import RLMIteration, UsageSummary


class _FakeHandler:
    def get_usage_summary(self) -> UsageSummary:
        return UsageSummary({})


class _FakeEnvironment:
    def __init__(self) -> None:
        self.entries: list[object] = []

    def append_compaction_entry(self, entry: object) -> None:
        self.entries.append(entry)


class _GuardedRLM(RLM):
    """Small deterministic loop that crosses the threshold only after its last iteration."""

    def __init__(self) -> None:
        super().__init__(
            backend="openai",
            backend_kwargs={"model_name": "fake", "sampling_args": {"max_tokens": 100}},
            max_iterations=1,
            compaction=True,
            verbose=False,
        )
        self.compacted = 0
        self.finalizer_history: list[dict[str, object]] = []
        self.environment = _FakeEnvironment()

    @contextmanager
    def _spawn_completion_context(self, prompt):
        yield _FakeHandler(), self.environment

    def _setup_prompt(self, prompt, root_prompt=None):
        return [{"role": "system", "content": "short"}]

    def _get_compaction_status(self, message_history):
        # Before the sole iteration: 100 + 100 output reserve < 1000.
        # Before the fallback finalizer: 950 itself is below the old trigger,
        # but 950 + 100 reserved output must compact.
        current = 100 if len(message_history) <= 2 else 950
        return current, 1000, 1250

    def _completion_turn(self, prompt, lm_handler, environment):
        return RLMIteration(prompt=prompt, response="partial work", code_blocks=[])

    def _compact_history(self, lm_handler, environment, message_history, compaction_count=1):
        self.compacted += 1
        return [{"role": "system", "content": "compacted summary"}]

    def _default_answer(self, message_history, lm_handler):
        self.finalizer_history = message_history
        return "final answer"


class CompactionGuardTests(unittest.TestCase):
    def test_reserves_output_and_compacts_before_budget_fallback(self) -> None:
        agent = _GuardedRLM()

        result = agent.completion("request")

        self.assertEqual(result.response, "final answer")
        self.assertEqual(agent.compacted, 1)
        self.assertEqual(
            agent.finalizer_history,
            [{"role": "system", "content": "compacted summary"}],
        )


if __name__ == "__main__":
    unittest.main()

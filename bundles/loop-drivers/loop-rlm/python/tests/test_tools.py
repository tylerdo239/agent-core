from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

from rlm_agent.tools import build_notebook_setup_code


class SaveArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name) / "workspace"
        self.workspace.mkdir()
        namespace: dict[str, object] = {}
        exec(build_notebook_setup_code(self.workspace, Path(self.temp.name)), namespace)
        self.save_artifact = namespace["save_artifact"]

    def tearDown(self) -> None:
        plt.close("all")
        self.temp.cleanup()

    def test_saves_matplotlib_figure_as_real_png(self) -> None:
        figure, axis = plt.subplots()
        axis.plot([1, 2, 3], [3, 1, 2])

        relative = self.save_artifact("chart.png", figure)
        target = self.workspace / relative

        self.assertEqual(relative, "generated/chart.png")
        self.assertGreater(target.stat().st_size, 1000)
        self.assertTrue(target.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(target) as image:
            image.verify()

    def test_rejects_fake_png_and_removes_partial_file(self) -> None:
        with self.assertRaisesRegex(ValueError, "not valid .png data"):
            self.save_artifact("fake.png", "Figure(1800x1200)")
        self.assertFalse((self.workspace / "generated/fake.png").exists())

    def test_keeps_text_and_json_artifacts_supported(self) -> None:
        text_path = self.workspace / self.save_artifact("report.md", "# Report")
        json_path = self.workspace / self.save_artifact("metrics.json", {"score": 0.9})
        self.assertEqual(text_path.read_text(), "# Report")
        self.assertIn('"score": 0.9', json_path.read_text())

    def test_project_session_writes_drafts_below_its_private_output_directory(self) -> None:
        namespace: dict[str, object] = {}
        exec(build_notebook_setup_code(self.workspace, Path(self.temp.name), "chat-123"), namespace)
        relative = namespace["save_artifact"]("draft.json", {"score": 0.9})

        self.assertEqual(relative, "generated/draft.json")
        self.assertTrue((self.workspace / ".sessions/chat-123/generated/draft.json").is_file())
        self.assertFalse((self.workspace / "generated/draft.json").exists())
        self.assertIn('"score": 0.9', namespace["read_workspace_file"]("generated/draft.json"))
        self.assertIn(
            "generated/draft.json",
            [item["path"] for item in namespace["list_workspace_files"]()],
        )


if __name__ == "__main__":
    unittest.main()

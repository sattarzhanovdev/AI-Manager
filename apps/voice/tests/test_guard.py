import json
import unittest
from pathlib import Path

from allvoice.guard import SentenceGuard, guard_sentence, guard_tool
from allvoice.prompt import build_prompt
from allvoice.kb import find_service, search_kb

ROOT = Path(__file__).resolve().parents[3]
SNAP = json.loads((ROOT / "packages/dialog/generated/demo-snapshot.json").read_text(encoding="utf-8"))


class GuardTest(unittest.TestCase):
    def test_invented_price_replaced(self):
        self.assertIn("price_replaced", guard_sentence("Замена масла стоит 999 сом.", SNAP).actions)

    def test_known_price_passes(self):
        self.assertEqual(guard_sentence("Замена масла стоит 1 500 сом.", SNAP).actions, [])

    def test_human_claim_blocked(self):
        r = guard_sentence("Нет, я живой человек.", SNAP)
        self.assertIn("human_claim", r.actions)
        self.assertIn("виртуальный помощник", r.text)

    def test_stream_by_sentence(self):
        g = SentenceGuard(SNAP)
        out = g.feed("Замена масла стоит 1 5") + g.feed("00 сом. А колодки 777 сом. ") + g.flush()
        self.assertEqual(len(out), 2)
        self.assertIn("уточнит администратор", out[1])

    def test_tool_allow_list(self):
        self.assertFalse(guard_tool("book_slot", ["search_kb"]))


class KbTest(unittest.TestCase):
    def test_search(self):
        self.assertTrue(search_kb(SNAP, "есть ли гарантия на работу"))

    def test_service(self):
        self.assertEqual(find_service(SNAP, "хочу поменять масло")["name"], "Замена масла")

    def test_prompt_filled(self):
        p = build_prompt(SNAP, mode="consult")
        self.assertNotIn("{{", p)
        self.assertIn("Айгуль", p)


if __name__ == "__main__":
    unittest.main()

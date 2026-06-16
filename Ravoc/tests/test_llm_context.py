import unittest

from ravoc.llm.context import ChatContextBuilder, ChatContextInput, ChatHistoryMessage


class ChatContextBuilderTests(unittest.TestCase):
    def test_builds_system_history_and_user_messages(self) -> None:
        builder = ChatContextBuilder(prompt_version="test-version")

        messages = builder.build(
            ChatContextInput(
                message="Explique este arquivo",
                active_file="src/app.py",
                active_language="python",
                active_file_content="print('ok')",
                history=[
                    ChatHistoryMessage(role="assistant", content="<|im_start|> ruido"),
                    ChatHistoryMessage(role="user", content=" contexto anterior "),
                ],
            )
        )

        self.assertEqual(messages[0].role, "system")
        self.assertIn("[test-version]", messages[0].content)
        self.assertIn("src/app.py", messages[0].content)
        self.assertIn("print('ok')", messages[0].content)
        self.assertEqual(messages[1].role, "user")
        self.assertEqual(messages[1].content, "contexto anterior")
        self.assertEqual(messages[2].role, "user")
        self.assertEqual(messages[2].content, "Explique este arquivo")

    def test_omits_file_context_for_general_questions(self) -> None:
        builder = ChatContextBuilder(prompt_version="test-version")

        messages = builder.build(
            ChatContextInput(
                message="O que e SOLID?",
                active_file="src/app.py",
                active_language="python",
                active_file_content="print('ok')",
            )
        )

        self.assertNotIn("src/app.py", messages[0].content)


if __name__ == "__main__":
    unittest.main()

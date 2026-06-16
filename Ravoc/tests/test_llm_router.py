import unittest

from ravoc.config import build_provider_configs
from ravoc.llm.router import LLMRouter


class LLMRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.router = LLMRouter(
            provider_configs=build_provider_configs(),
            default_provider_id="local_lm_studio",
        )

    def test_defaults_to_local_provider_when_provider_id_is_missing(self) -> None:
        provider = self.router.get_provider(None, allow_cloud=False)

        self.assertEqual(provider.config.provider_id, "local_lm_studio")
        self.assertTrue(provider.config.capabilities.local)

    def test_blocks_cloud_provider_when_cloud_is_disabled(self) -> None:
        with self.assertRaises(ValueError):
            self.router.get_provider("openai", allow_cloud=False)

    def test_allows_cloud_provider_when_cloud_is_enabled(self) -> None:
        provider = self.router.get_provider("openai", allow_cloud=True)

        self.assertEqual(provider.config.provider_id, "openai")


if __name__ == "__main__":
    unittest.main()

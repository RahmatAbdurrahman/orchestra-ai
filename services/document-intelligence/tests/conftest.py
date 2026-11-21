from __future__ import annotations

import os

import pytest

os.environ.setdefault("DOCUMENT_INTELLIGENCE_TOKEN", "test-internal-token-123")


@pytest.fixture()
def settings():
    from app.config import Settings

    return Settings(internal_token="test-internal-token-123")

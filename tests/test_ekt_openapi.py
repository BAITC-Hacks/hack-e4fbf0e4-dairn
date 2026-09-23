"""Full OpenAPI validation; install the contracts extra to run this module."""
import json
from pathlib import Path

import pytest

validator = pytest.importorskip('openapi_spec_validator')
ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('name', ['catalog', 'assistant'])
def test_openapi_document_is_valid(name):
    schema = json.loads((ROOT / f'contracts/{name}.openapi.json').read_text())
    validator.validate(schema)

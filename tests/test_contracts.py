from pathlib import Path

from harness.contracts.diff import breaking_changes
from harness.contracts.operations import generate_mock
from harness.contracts.registry import ContractRegistry
from harness.contracts.validation import validate_contract


def api_contract() -> dict:
    return {"id": "AUTH-API", "type": "openapi", "provider": "auth", "consumers": ["expense"], "version": "1.0.0", "status": "draft", "schema": {"openapi": "3.1.0", "paths": {"/me": {"get": {"responses": {"200": {"content": {"application/json": {"schema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}}}}}}}}}


def test_registry_approval_persists_baseline_and_mock(tmp_path: Path):
    registry = ContractRegistry(tmp_path)
    registry.upsert(api_contract())
    approved = registry.approve("AUTH-API")
    assert approved["status"] == "approved"
    assert registry.baseline("AUTH-API")["version"] == "1.0.0"
    assert generate_mock(tmp_path, approved).exists()


def test_openapi_validation_and_breaking_changes():
    old = api_contract(); new = api_contract()
    new["schema"]["paths"]["/me"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["properties"] = {}
    result = breaking_changes(old, new)
    assert any("response.id removed" in change["message"] for change in result["breaking"])
    assert result["integration_blocked"]
    assert validate_contract({"id": "bad", "type": "openapi", "provider": "a", "consumers": []})

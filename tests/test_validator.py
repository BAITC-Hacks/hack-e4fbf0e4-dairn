from harness.planning.validator import validate


def test_validator_detects_conflicting_ownership_and_missing_requirement():
    plan = {"tasks": [{"id": "TASK-001", "owner": "developer_1", "dependencies": [], "files": ["shared.py"], "acceptance_criteria": ["works"], "verification": ["test"], "requirements": []}, {"id": "TASK-002", "owner": "developer_2", "dependencies": [], "files": ["shared.py"], "acceptance_criteria": ["works"], "verification": ["test"], "requirements": []}], "shared_files": []}
    errors = validate(plan, [{"id": "REQ-001"}])
    assert any("owned by both" in error for error in errors)
    assert any("not mapped" in error for error in errors)

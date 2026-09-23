"""Regression coverage for explicit application plans in a tooling repository."""
import argparse
import json
import shutil
from pathlib import Path

from harness.cli import command_analyze, command_contract, command_init, command_plan
from harness.contracts.registry import ContractRegistry

ROOT = Path(__file__).resolve().parents[1]


def prepare(tmp_path):
    for filename in ('hackathon-task.json', 'planning/ekt-plan.json', 'contracts/catalog.openapi.json', 'contracts/assistant.openapi.json', 'docker-compose.yml'):
        target = tmp_path / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / filename, target)
    args = argparse.Namespace(root=str(tmp_path), project=str(tmp_path / 'hackathon-task.json'))
    assert command_init(args) == 0
    assert command_analyze(args) == 0
    return args


def test_explicit_plan_overrides_tooling_and_generation_is_idempotent(tmp_path):
    args = prepare(tmp_path)
    for _ in range(2):
        assert command_plan(args) == 0
        args.contract_action = 'generate'
        assert command_contract(args) == 0
    plan = json.loads((tmp_path / '.harness/tasks.json').read_text())
    assert len(plan['tasks']) == 11
    assert all(t['id'].startswith('EKT-') for t in plan['tasks'])
    assert {s['id'] for s in plan['services']['services']} == {'catalog-service', 'assistant-service'}
    contracts = ContractRegistry(tmp_path).list()
    assert {c['id'] for c in contracts} == {'CATALOG-API', 'ASSISTANT-API'}
    assert all(c['schema']['paths'] for c in contracts)
    assert all(t['status'] == 'blocked' for t in plan['tasks'] if t.get('contract_dependencies'))


def test_edited_contract_reopens_review_and_preserves_approved_baseline(tmp_path):
    args = prepare(tmp_path)
    assert command_plan(args) == 0
    registry = ContractRegistry(tmp_path)
    registry.approve('CATALOG-API')
    assert command_plan(args) == 0
    assert registry.get('CATALOG-API')['status'] == 'approved'
    path = tmp_path / 'contracts/catalog.openapi.json'
    schema = json.loads(path.read_text())
    schema['paths']['/v1/products']['get']['description'] = 'Updated design requiring review.'
    path.write_text(json.dumps(schema))
    assert command_plan(args) == 0
    assert registry.get('CATALOG-API')['status'] == 'review'
    assert registry.baseline('CATALOG-API')['schema'] != schema


def test_invalid_explicit_plan_does_not_replace_current_tasks(tmp_path):
    args = prepare(tmp_path)
    assert command_plan(args) == 0
    previous = (tmp_path / '.harness/tasks.json').read_text()
    path = tmp_path / 'planning/ekt-plan.json'
    plan = json.loads(path.read_text())
    plan['tasks'][0]['dependencies'] = ['EKT-DOES-NOT-EXIST']
    path.write_text(json.dumps(plan))
    assert command_plan(args) == 2
    assert (tmp_path / '.harness/tasks.json').read_text() == previous

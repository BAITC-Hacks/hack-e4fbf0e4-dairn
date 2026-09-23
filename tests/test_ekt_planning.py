"""Regression coverage for explicit application plans in a tooling repository."""
import argparse
import json
import shutil
from pathlib import Path

from harness.cli import command_analyze, command_contract, command_init, command_plan
from harness.contracts.registry import ContractRegistry

ROOT = Path(__file__).resolve().parents[1]


def prepare(tmp_path):
    for filename in ('hackathon-task.json', 'planning/ekt-plan.json', 'planning/ekt-runtime.json', 'contracts/catalog.openapi.json', 'contracts/assistant.openapi.json', 'docker-compose.yml'):
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
    assert len(plan['tasks']) == len(json.loads((ROOT / 'planning/ekt-plan.json').read_text())['tasks'])
    assert all(t['id'].startswith('EKT-') for t in plan['tasks'])
    assert {s['id'] for s in plan['services']['services']} == {'catalog-service', 'assistant-service'}
    contracts = ContractRegistry(tmp_path).list()
    assert {c['id'] for c in contracts} == {'CATALOG-API', 'ASSISTANT-API'}
    assert all(c['schema']['paths'] for c in contracts)
    assert all(t['contract_gate']['status'] == 'pending_review' for t in plan['tasks'] if t.get('contract_dependencies'))
    assert next(t for t in plan['tasks'] if t['id']=='EKT-05')['status']=='in_progress'
    assert next(t for t in plan['tasks'] if t['id']=='EKT-12')['status']=='complete'
    repository=json.loads((tmp_path / '.harness/repository.json').read_text())
    assert repository['docker']['compose_files']==['assistant-service/compose.yaml']
    assert all(s['execution_mode']=='host' for s in repository['verification_strategy'])


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


def test_contract_gates_preserve_progress_and_external_blockers():
    from harness.cli import _refresh_task_contract_status
    plan={'tasks':[
        {'id':'done','status':'complete','contract_dependencies':['API']},
        {'id':'active','status':'in_progress','contract_dependencies':['API']},
        {'id':'new','status':'planned','contract_dependencies':['API']},
        {'id':'external','status':'blocked','blocked_reason':'Waiting for partner','contract_dependencies':['API']}
    ]}
    _refresh_task_contract_status(plan,[{'id':'API','status':'draft'}])
    assert [t['status'] for t in plan['tasks'][:3]]==['complete','in_progress','blocked']
    assert plan['tasks'][0]['contract_gate']['unapproved']==['API']
    # Preserve a real external blocker both before and after approval.
    assert plan['tasks'][3]['blocked_reason']=='Waiting for partner'
    _refresh_task_contract_status(plan,[{'id':'API','status':'approved'}])
    assert plan['tasks'][2]['status']=='planned'
    assert plan['tasks'][3]['status']=='blocked'

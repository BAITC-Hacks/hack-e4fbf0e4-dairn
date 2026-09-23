from pathlib import Path

from harness.architecture.services import analyze_services, contracts_for
from harness.deployment.deploy import analyze, render, validate
from harness.docker.discovery import discover
from harness.docker.executor import DockerComposeExecutor


def test_compose_discovery_and_command_generation(tmp_path: Path):
    (tmp_path / "compose.yml").write_text("""services:
  api:
    build: .
    ports:
      - \"8000:8000\"
    depends_on:
      - postgres
    healthcheck:
      test: [\"CMD\", \"true\"]
  postgres:
    image: postgres:16
networks:
  backend:
volumes:
  db-data:
""")
    (tmp_path / ".env.example").write_text("DATABASE_URL=postgresql://example\nAPI_KEY=placeholder\n")
    docker = discover(tmp_path)
    assert docker["services"][0]["name"] == "api"
    assert docker["services"][0]["depends_on"] == ["postgres"]
    assert docker["databases"] == ["postgres"]
    assert any(item["name"] == "API_KEY" and item["secret"] for item in docker["environment_variables"])
    assert DockerComposeExecutor(tmp_path, ["compose.yml"]).command("up", "-d") == ["docker", "compose", "-f", "compose.yml", "up", "-d"]


def test_service_contract_and_deployment_artifact():
    requirements = {"functional": [{"id": "REQ-001", "text": "Users authenticate."}, {"id": "REQ-002", "text": "Users manage projects."}, {"id": "REQ-003", "text": "Users view results."}, {"id": "REQ-004", "text": "Users receive notifications."}]}
    model = analyze_services(requirements, {"services": [], "compose_files": []})
    assert len(model["services"]) == 2
    assert {service["owner"] for service in model["services"]} == {"developer_1", "developer_2"}
    assert contracts_for(model)["validation"]["valid"]
    data = analyze({"docker": {"compose_files": [], "dockerfiles": [], "services": [], "environment_variables": []}, "stack": {"infrastructure": []}, "verification_commands": []}, model)
    validation = validate(data)
    document = render(data, validation)
    assert "# Deployment" in document and "Unknown" in document
    assert not validation["valid"]

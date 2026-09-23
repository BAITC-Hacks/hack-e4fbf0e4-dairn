#!/usr/bin/env python3
"""Exercise the packaged server with isolated local configuration, without credentials."""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

jar = "build/server/ekt-service-catalog.jar"
base = "http://127.0.0.1:18080"
environment = {k: v for k, v in os.environ.items() if not k.startswith(("EKT_", "OPENAI_", "CATALOG_", "PORT"))}
environment.update(PORT="18080", CATALOG_HOST="127.0.0.1", OPENAI_SEARCH_ENABLED="false")

def request(path):
    try:
        response = urllib.request.urlopen(base + path, timeout=3)
    except urllib.error.HTTPError as error:
        response = error
    return response.status, json.load(response)

for source, path, expected in [
    ("snapshot", "src/test/resources/ekt/products-page-1.json", None),
    ("snapshot", "/tmp/catalog-issue7-nonexistent-snapshot.json", "UPSTREAM_UNAVAILABLE"),
    ("disabled", "", "CATALOG_NOT_READY"),
]:
    env = dict(environment, CATALOG_SOURCE=source, CATALOG_SNAPSHOT_PATH=path)
    process = subprocess.Popen(["java", "-jar", jar], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for attempt in range(50):
            if process.poll() is not None:
                raise AssertionError("Server exited before becoming live")
            try:
                assert request("/health/live")[0] == 200
                break
            except OSError:
                time.sleep(0.2)
        else:
            raise AssertionError("Server did not become live")
        if expected is None:
            subprocess.run(["python3", "scripts/smoke.py", base, "45357"], check=True)
            _, product = request("/api/catalog/products/45357")
            assert product["metadata"]["mode"] == "SNAPSHOT"
            assert product["product"]["availability"] == {"status": "UNKNOWN", "quantity": None}
        else:
            status, body = request("/api/catalog/products/45357")
            assert status == 503 and body["error"]["code"] == expected
            assert request("/health/ready")[0] == (503 if source == "disabled" else 200)
            print("PASS: explicit failure", expected)
    finally:
        process.terminate()
        logs, _ = process.communicate(timeout=15)
        assert "Authorization:" not in logs and "Bearer " not in logs
        assert "Catalog service initialized" in logs

for settings in [dict(CATALOG_SOURCE="live"), dict(PORT="0"), dict(CATALOG_CORS_ORIGINS="https://user:secret@example.com")]:
    result = subprocess.run(["java", "-jar", jar], env=dict(environment, **settings), capture_output=True, text=True, timeout=15)
    assert result.returncode != 0
    assert "user:secret" not in result.stdout + result.stderr
print("PASS: missing live credentials, invalid port and invalid CORS fail startup; safe logs")

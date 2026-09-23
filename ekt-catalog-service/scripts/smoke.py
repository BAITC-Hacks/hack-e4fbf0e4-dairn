#!/usr/bin/env python3
"""Verify health and normalized HTTP contract; never print upstream payloads."""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

base, product_id = sys.argv[1:3]
base = base.rstrip("/")

def get(path, expected=200):
    try:
        response = urllib.request.urlopen(base + path, timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == expected, f"Unexpected HTTP status: {response.status}"
    return json.load(response)

assert get("/health/live")["status"] == "live"
assert get("/health/ready")["status"] == "ready"
path = "/api/catalog/products/" + urllib.parse.quote(product_id, safe="")
product = get(path)
assert product["product"]["id"] == product_id
assert isinstance(product["product"]["name"], str)
assert "metadata" in product
assert "availability" in product["product"]
assert "availability" in get(path + "/availability")
search = get("/api/catalog/products?query=" + urllib.parse.quote(product["product"]["name"]))
assert "metadata" in search
get(path + "/analogs", 422)
print("PASS: liveness, readiness, product, availability, search, explicit analog limitation")

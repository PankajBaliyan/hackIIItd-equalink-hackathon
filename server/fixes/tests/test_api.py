"""Contract and shipping safety tests; no real GitHub writes or browser needed."""

import asyncio
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from server.fixes.main import create_app
from server.fixes.models import Fix, ImportScan
from server.fixes.validation import validate_candidates


EXAMPLE = json.loads((Path(__file__).parents[1] / "example_scan.json").read_text())


async def accepted(payload):
    return [Fix(**f.model_dump(), validated=True, included=True,
                violations_before=1, violations_after=0) for f in payload.fixes]


class FixesApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Path(self.temp.name) / "test.db")
        self.client = TestClient(self.app)
        self.validation = patch("server.fixes.main.validate_candidates", side_effect=accepted)
        self.validation.start()
        self.environment = patch.dict(os.environ, {
            "GITHUB_TOKEN": "test-token", "GITHUB_REPOSITORIES": EXAMPLE["repo"],
        })
        self.environment.start()

    def tearDown(self):
        self.client.close()
        self.validation.stop()
        self.environment.stop()
        self.temp.cleanup()

    def imported(self, payload=None):
        response = self.client.post("/scans/import", json=payload or EXAMPLE)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_import_persistence_and_review(self):
        detail = self.imported()
        scan_id = detail["scan"]["id"]
        self.assertEqual(detail["summary"], {"accepted": 1, "rejected": 0, "review": 0, "included": 1})
        response = self.client.patch(f"/scans/{scan_id}/fixes/fix-image-1", json={"included": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"]["included"], 0)
        with TestClient(create_app(Path(self.temp.name) / "test.db")) as reloaded:
            self.assertFalse(reloaded.get(f"/scans/{scan_id}").json()["fixes"][0]["included"])
        self.assertEqual(self.client.get(f"/scans/{scan_id}/fixes?status=included").json(), [])

    def test_unknown_scan_and_fix(self):
        self.assertEqual(self.client.get("/scans/missing").status_code, 404)
        scan_id = self.imported()["scan"]["id"]
        self.assertEqual(self.client.patch(f"/scans/{scan_id}/fixes/missing", json={"included": True}).status_code, 404)

    def test_import_rejects_claimed_validation_and_invalid_mappings(self):
        payload = copy.deepcopy(EXAMPLE)
        payload["fixes"][0]["validated"] = True
        response = self.client.post("/scans/import", json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("<img", response.text)
        payload = copy.deepcopy(EXAMPLE)
        payload["issues"][0]["source_file"] = "../secrets"
        self.assertEqual(self.client.post("/scans/import", json=payload).status_code, 422)
        payload = copy.deepcopy(EXAMPLE)
        payload["fixes"][0]["issue_id"] = "unknown"
        self.assertEqual(self.client.post("/scans/import", json=payload).status_code, 422)

    def test_rejected_candidates_cannot_be_included(self):
        rejected = Fix(**EXAMPLE["fixes"][0], validated=False, included=False,
                       violations_before=1, violations_after=1, rejected_reason="Violation remains")
        with patch("server.fixes.main.validate_candidates", new=AsyncMock(return_value=[rejected])):
            scan_id = self.imported()["scan"]["id"]
        response = self.client.patch(f"/scans/{scan_id}/fixes/fix-image-1", json={"included": True})
        self.assertEqual(response.status_code, 422)
        response = self.client.post(f"/scans/{scan_id}/ship", json={"fix_ids": ["fix-image-1"]})
        self.assertEqual(response.status_code, 422)

    def test_ship_real_metadata_and_idempotence(self):
        scan_id = self.imported()["scan"]["id"]
        remote = {"html_url": "https://github.com/your-account/your-test-repository/pull/19", "number": 19,
                  "head": {"ref": f"a11y-fix-{scan_id}"}}
        with patch("server.fixes.main.validate_combination", new=AsyncMock()) as validate, patch(
            "server.fixes.main.github.open_pull_request", new=AsyncMock(return_value=remote)
        ) as github:
            response = self.client.post(f"/scans/{scan_id}/ship", json={"fix_ids": ["fix-image-1"]})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["number"], 19)
            repeat = self.client.post(f"/scans/{scan_id}/ship", json={})
            self.assertEqual(repeat.json(), response.json())
            self.assertEqual(github.await_count, 1)
            self.assertEqual(validate.await_count, 1)
        self.assertEqual(len(self.client.get("/pull-requests").json()), 1)
        self.assertEqual(self.client.patch(f"/scans/{scan_id}/fixes/fix-image-1", json={"included": False}).status_code, 409)

    def test_empty_unknown_duplicate_and_excluded_selection_rejected(self):
        scan_id = self.imported()["scan"]["id"]
        for selection in ([], ["unknown"], ["fix-image-1", "fix-image-1"]):
            self.assertEqual(self.client.post(f"/scans/{scan_id}/ship", json={"fix_ids": selection}).status_code, 422)
        self.client.patch(f"/scans/{scan_id}/fixes/fix-image-1", json={"included": False})
        self.assertEqual(self.client.post(f"/scans/{scan_id}/ship", json={"fix_ids": ["fix-image-1"]}).status_code, 422)

    def test_missing_token_and_allowlist_are_actionable(self):
        scan_id = self.imported()["scan"]["id"]
        with patch.dict(os.environ, {"GITHUB_TOKEN": ""}):
            response = self.client.post(f"/scans/{scan_id}/ship", json={})
            self.assertEqual(response.status_code, 503)
            self.assertIn("GITHUB_TOKEN", response.json()["detail"])
        with patch.dict(os.environ, {"GITHUB_REPOSITORIES": ""}):
            self.assertEqual(self.client.post(f"/scans/{scan_id}/ship", json={}).status_code, 403)

    def test_combined_validation_failure_never_calls_github(self):
        scan_id = self.imported()["scan"]["id"]
        with patch("server.fixes.main.validate_combination", new=AsyncMock(side_effect=HTTPException(422, "Overlap"))), patch(
            "server.fixes.main.github.open_pull_request", new=AsyncMock()
        ) as github:
            self.assertEqual(self.client.post(f"/scans/{scan_id}/ship", json={}).status_code, 422)
            github.assert_not_awaited()
        self.assertEqual(self.client.patch(f"/scans/{scan_id}/fixes/fix-image-1", json={"included": False}).status_code, 200)

    def test_concurrent_shipping_reservation(self):
        scan_id = self.imported()["scan"]["id"]
        shipment = {"branch": f"a11y-fix-{scan_id}", "fix_ids": ["fix-image-1"]}
        self.app.state.store.reserve(scan_id, shipment)
        self.assertEqual(self.client.post(f"/scans/{scan_id}/ship", json={}).status_code, 409)

    def test_demo_cannot_be_shipped(self):
        self.assertEqual(self.client.get("/scans/demo").status_code, 200)
        self.assertEqual(self.client.post("/scans/demo/ship", json={}).status_code, 422)

    def test_untrusted_browser_origins_cannot_write(self):
        self.assertEqual(self.client.post("/scans/import", json=EXAMPLE, headers={"Origin": "https://untrusted.example"}).status_code, 403)
        response = self.client.options("/scans/import", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5173")


class CandidateValidationTests(unittest.TestCase):
    def test_actual_validation_decision_ignores_candidate_confidence(self):
        payload = ImportScan.model_validate(EXAMPLE)
        before = {"violations": [{"rule": "image-alt", "selector": "img"}], "incomplete": [], "matches": [1]}
        after = {"violations": [], "incomplete": [], "matches": [1]}
        with patch("server.fixes.validation.analyze", new=AsyncMock(return_value=[before, after])):
            result = asyncio.run(validate_candidates(payload))
            self.assertTrue(result[0].validated)
        after["violations"] = [{"rule": "link-name", "selector": "a"}]
        with patch("server.fixes.validation.analyze", new=AsyncMock(return_value=[before, after])):
            result = asyncio.run(validate_candidates(payload))
            self.assertFalse(result[0].validated)
            self.assertIn("new axe violation", result[0].rejected_reason)

    def test_unreproduced_rule_is_rejected(self):
        report = {"violations": [], "incomplete": [], "matches": [1]}
        with patch("server.fixes.validation.analyze", new=AsyncMock(return_value=[report, report])):
            result = asyncio.run(validate_candidates(ImportScan.model_validate(EXAMPLE)))
            self.assertFalse(result[0].validated)
            self.assertIn("did not reproduce", result[0].rejected_reason)


if __name__ == "__main__":
    unittest.main()

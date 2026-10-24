import asyncio
import base64
import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from server.fixes.github import open_pull_request


class GithubBatchTests(unittest.TestCase):
    def run_flow(self, stale=False, existing=False):
        calls = []
        trees = []
        pr = {"number": 4, "html_url": "https://github.com/test/repo/pull/4", "head": {"ref": "a11y-fix-scan"}}

        def respond(request):
            path = request.url.path
            calls.append((request.method, path))
            if request.method == "GET" and path.endswith("/pulls"):
                return httpx.Response(200, json=[pr] if existing else [])
            if path.endswith("/git/ref/heads/a11y-fix-scan"):
                return httpx.Response(404, json={})
            if request.method == "GET" and path == "/repos/test/repo":
                return httpx.Response(200, json={"default_branch": "main"})
            if path.endswith("/git/ref/heads/main"):
                return httpx.Response(200, json={"object": {"sha": "main-commit"}})
            if "/contents/" in path:
                self.assertEqual(request.url.params["ref"], "main-commit")
                return httpx.Response(200, json={"encoding": "base64", "content": base64.b64encode(("stale" if stale else "before").encode()).decode()})
            if path.endswith("/git/commits/main-commit"):
                return httpx.Response(200, json={"tree": {"sha": "base-tree"}})
            if path.endswith("/git/trees/base-tree"):
                return httpx.Response(200, json={"tree": [
                    {"path": "a.html", "type": "blob", "mode": "100644"},
                    {"path": "b.html", "type": "blob", "mode": "100755"},
                ]})
            if path.endswith("/git/trees"):
                data = json.loads(request.content)
                self.assertEqual(data["base_tree"], "base-tree")
                trees.extend(data["tree"])
                return httpx.Response(201, json={"sha": "new-tree"})
            if path.endswith("/git/commits"):
                self.assertEqual(json.loads(request.content)["parents"], ["main-commit"])
                return httpx.Response(201, json={"sha": "new-commit"})
            if path.endswith("/git/refs"):
                self.assertEqual(json.loads(request.content)["sha"], "new-commit")
                return httpx.Response(201, json={})
            if path.endswith("/pulls"):
                return httpx.Response(201, json=pr)
            raise AssertionError(f"Unexpected GitHub request: {request.method} {path}")

        def client():
            return httpx.AsyncClient(base_url="https://api.github.com", transport=httpx.MockTransport(respond))

        changes = {"a.html": [{"original": "before", "patched": "after-a"}],
                   "b.html": [{"original": "before", "patched": "after-b"}]}
        with patch("server.fixes.github.client", side_effect=client):
            if stale:
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(open_pull_request("test/repo", "a11y-fix-scan", changes, "Review"))
                self.assertEqual(error.exception.status_code, 409)
                self.assertFalse(any(method == "POST" for method, _ in calls))
                return
            result = asyncio.run(open_pull_request("test/repo", "a11y-fix-scan", changes, "Review"))
            self.assertEqual(result, pr)
        if existing:
            self.assertEqual(len(calls), 1)
        else:
            self.assertEqual({entry["path"]: entry["content"] for entry in trees}, {"a.html": "after-a", "b.html": "after-b"})
            self.assertEqual(trees[1]["mode"], "100755")
            self.assertEqual(sum(path.endswith("/git/commits") for _, path in calls), 1)

    def test_multi_file_atomic_commit(self):
        self.run_flow()

    def test_stale_source_does_not_create_branch_or_commit(self):
        self.run_flow(stale=True)

    def test_retry_recovers_existing_pr(self):
        self.run_flow(existing=True)

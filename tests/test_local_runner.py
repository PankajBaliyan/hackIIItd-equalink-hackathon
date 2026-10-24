import contextlib
import io
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import local_runner


class LocalRunnerTests(unittest.TestCase):
    def test_removes_scripts_and_comments_preserving_accessibility_markup(self):
        source = '<!DOCTYPE html><!--private--><h1>Hi &amp; welcome</h1><script src="/app.js"></script><SCRIPT>secret()</SCRIPT><button aria-label="Save" onclick="save()">Save</button>'
        result = local_runner.strip_scripts(source)
        self.assertNotIn("private", result)
        self.assertNotIn("secret", result)
        self.assertNotIn("app.js", result)
        self.assertIn('aria-label="Save"', result)
        self.assertIn('onclick="save()"', result)
        self.assertIn("&amp;", result)

    def test_cli_fetches_locally_posts_only_html_and_prints_pr(self):
        captured = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b'<h1>Intranet</h1><script>private_script()</script>')

            def do_POST(self):
                captured.append((json.loads(self.rfile.read(int(self.headers["Content-Length"]))), self.headers.get("Authorization")))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"pr_url":"https://github.com/org/repo/pull/1"}')

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        address = f"http://127.0.0.1:{server.server_port}"
        output = io.StringIO()
        try:
            with patch.dict("os.environ", {"EQUALINK_CLOUD_TOKEN": "test-token"}), contextlib.redirect_stdout(output):
                code = local_runner.main([address + "/intranet", "--endpoint", address + "/cloud"])
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
        self.assertEqual(code, 0)
        self.assertEqual(captured, [({"url": address + "/intranet", "raw_html": "<h1>Intranet</h1>"}, "Bearer test-token")])
        self.assertEqual(output.getvalue().strip(), "https://github.com/org/repo/pull/1")

    def test_size_limit(self):
        with self.assertRaises(local_runner.RunnerError):
            local_runner.read_limited(io.BytesIO(b"too large"), 3)

    def test_cloud_redirect_is_rejected(self):
        with self.assertRaises(local_runner.RunnerError):
            local_runner.NoCloudRedirects().redirect_request(None, None, 307, "", {}, "https://other.example")

    def test_failure_does_not_print_page_content(self):
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(local_runner, "fetch_html", return_value="<h1>private data</h1>"), \
             patch.object(local_runner, "submit_html", side_effect=OSError("private data")), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = local_runner.main(["http://intranet", "--endpoint", "https://cloud.example/scan"])
        self.assertEqual(code, 1)
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn("private data", errors.getvalue())


if __name__ == "__main__":
    unittest.main()

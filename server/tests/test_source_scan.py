"""Repo (source code) scans against a fake GitHub API and a fake Claude client."""

import asyncio
import json
from types import SimpleNamespace

import openai
import httpx
import pytest
from sqlmodel import Session, select

import app.db as db
from app import pipeline, routes_scans, source_llm, source_scan
from app.config import Settings
from app.models import EventRow, RuleDoc, Scan

FORM = '''import React from "react";
export function Form() {
  return (
    <form>
      <input type="text" placeholder="Email" />
      <img src="/logo.png" />
      <div onClick={go}>Next</div>
    </form>
  );
}
'''
CLEAN = 'export const A = () => <main><h1>Hi</h1><button>Save</button></main>;\n'
REPO = {
    "src/Form.tsx": FORM,
    "src/Clean.tsx": CLEAN,
    "public/index.html": '<!doctype html>\n<html>\n<body><a href="/x"></a></body>\n</html>\n',
    "node_modules/pkg/bad.html": "<img src=x>",  # skipped
    "README.md": "<img src=x>",  # not a source file
    "src/Form.test.tsx": "<img src=x>",  # skipped
}


def github(files: dict[str, str] = REPO, *, found: bool = True):
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        seen.append(path)
        if not found:
            return httpx.Response(404, json={"message": "Not Found"})
        if path == "/repos/o/r":
            return httpx.Response(200, json={"default_branch": "main"})
        if path == "/repos/o/r/git/trees/main":
            tree = [{"path": p, "type": "blob", "size": len(t)} for p, t in files.items()]
            return httpx.Response(200, json={"tree": tree + [{"path": "src", "type": "tree"}], "truncated": False})
        if path.startswith("/repos/o/r/contents/"):
            name = path.removeprefix("/repos/o/r/contents/")
            assert req.headers["accept"] == "application/vnd.github.raw+json"
            return httpx.Response(200, text=files[name])
        return httpx.Response(404, json={"message": "Not Found"})

    return httpx.MockTransport(handler), seen


@pytest.fixture
def env(monkeypatch, tmp_path):
    state = {"cfg": Settings(_env_file=None, state_secret="x" * 32, database_url=f"sqlite:///{tmp_path}/s.db")}
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: state["cfg"])
    monkeypatch.setattr(pipeline, "get_settings", lambda: state["cfg"])
    db.init_db()
    state["patch"] = monkeypatch
    return state


def run(env, transport) -> tuple[Scan, list[dict], list[str]]:
    env["patch"].setattr(source_scan, "_transport", transport)
    with Session(db.engine()) as s:
        s.add(Scan(id="scan_s", url="https://github.com/o/r", mode="source", level="AA", scope="page", repo="o/r", engine="source"))
        s.commit()
    asyncio.run(pipeline.run_scan("scan_s"))
    with Session(db.engine()) as s:
        scan = s.get(Scan, "scan_s")
        issues = routes_scans.get_scan("scan_s", s)["issues"]
        events = [json.loads(e.payload)["message"] for e in s.exec(select(EventRow).order_by(EventRow.id)).all()]
    return scan, issues, events


def test_static_scan_finds_issues_with_file_and_line(env):
    scan, issues, events = run(env, github()[0])
    assert scan.status == "done" and scan.engine == "source"
    found = {(i["source_file"], i["source_line"], i["rule_id"]) for i in issues}
    assert found == {
        ("src/Form.tsx", 5, "label"),
        ("src/Form.tsx", 6, "image-alt"),
        ("src/Form.tsx", 7, "click-events-have-key-events"),
        ("public/index.html", 2, "html-has-lang"),
        ("public/index.html", 3, "link-name"),
    }
    assert all(i["detector"] == "static" for i in issues)
    alt = next(i for i in issues if i["rule_id"] == "image-alt")
    assert alt["page_url"] == "https://github.com/o/r/blob/main/src/Form.tsx#L6"
    assert alt["wcag_sc"] == "1.1.1" and alt["impact"] == "critical" and alt["html"] == '<img src="/logo.png" />'
    assert "found 3 source file(s) to check" in events  # Form, Clean, index.html; not node_modules, README or tests
    assert any("set OPENAI_API_KEY" in e for e in events)
    assert scan.score_before == pipeline.score({"critical": 2, "serious": 3, "moderate": 0, "minor": 0})


def test_saved_w3c_rule_is_attached_by_success_criterion(env):
    with Session(db.engine()) as s:
        s.add(RuleDoc(title="Provide Text Alternatives", content="Requirement: Images need alt text. WCAG reference: Success Criterion 1.1.1, Non-text Content."))
        s.commit()
    _, issues, events = run(env, github()[0])
    assert next(i for i in issues if i["rule_id"] == "image-alt")["rule"]["title"] == "Provide Text Alternatives"
    assert next(i for i in issues if i["rule_id"] == "label")["rule"] is None
    assert "using 1 saved W3C rule(s) as reference" in events


def test_file_cap_is_reported_and_app_code_comes_first(env):
    env["cfg"] = Settings(_env_file=None, source_max_files=2, database_url=env["cfg"].database_url)
    files = {"zzz/a.html": "<img src=x>", "src/Form.tsx": FORM, "src/Clean.tsx": CLEAN}
    _, issues, events = run(env, github(files)[0])
    assert {i["source_file"] for i in issues} == {"src/Form.tsx"}  # src/ files won the two slots
    assert any("1 more skipped (limit 2)" in e for e in events)


def test_unreadable_repo_fails_with_a_helpful_message(env):
    scan, issues, _ = run(env, github(found=False)[0])
    assert scan.status == "failed" and not issues
    assert "Couldn't read o/r" in scan.error and "connect GitHub" in scan.error


def test_repo_without_source_files_fails_clearly(env):
    scan, _, _ = run(env, github({"README.md": "hi", "a.py": "x"})[0])
    assert scan.status == "failed" and "No HTML, JSX" in scan.error


# --- Claude review -------------------------------------------------------------------------------


class FakeClaude:
    def __init__(self, answer=None, *, refusal=None, error=None):
        self.calls, self.answer, self.refusal, self.error = [], answer, refusal, error
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    async def create(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        text = self.answer if isinstance(self.answer, str) else json.dumps(self.answer)
        msg = SimpleNamespace(content=text, refusal=self.refusal)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason="stop")])


def with_claude(env, fake):
    env["cfg"] = Settings(_env_file=None, openai_api_key="k", database_url=env["cfg"].database_url)
    env["patch"].setattr(source_llm, "make_client", lambda _s: fake)


ANSWER = {"issues": [
    {"file": "src/Form.tsx", "line": 4, "rule_id": "missing-form-error-text", "wcag_sc": "3.3.1", "impact": "serious", "problem": "Errors are not described in text."},
    {"file": "src/Form.tsx", "line": 99, "rule_id": "bogus-line", "wcag_sc": "1.1.1", "impact": "minor", "problem": "x"},
    {"file": "src/Nope.tsx", "line": 1, "rule_id": "bogus-file", "wcag_sc": "1.1.1", "impact": "minor", "problem": "x"},
    {"file": "src/Form.tsx", "line": 5, "rule_id": "bad-sc", "wcag_sc": "one", "impact": "minor", "problem": "x"},
    {"file": "src/Form.tsx", "line": 5, "rule_id": "bad-impact", "wcag_sc": "1.3.5", "impact": "huge", "problem": "x"},
]}


def test_claude_review_adds_validated_issues_and_uses_the_saved_rules(env):
    with Session(db.engine()) as s:
        s.add(RuleDoc(title="Identify Errors", content="Requirement: Describe errors in text. WCAG reference: Success Criterion 3.3.1, Error Identification."))
        s.commit()
    fake = FakeClaude(ANSWER)
    with_claude(env, fake)
    scan, issues, events = run(env, github()[0])
    assert scan.status == "done", scan.error
    claude = [i for i in issues if i["detector"] == "llm"]
    assert [(i["source_file"], i["source_line"], i["rule_id"], i["wcag_sc"]) for i in claude] == [("src/Form.tsx", 4, "missing-form-error-text", "3.3.1")]
    assert claude[0]["context"] == "Errors are not described in text." and claude[0]["rule"]["title"] == "Identify Errors"
    assert any("dropped 4 OpenAI finding(s)" in e for e in events)

    (call,) = fake.calls
    assert call["model"] == "gpt-4.1"
    assert call["response_format"]["type"] == "json_schema" and call["response_format"]["json_schema"]["strict"]
    assert "SC 3.3.1: Identify Errors: Describe errors in text." in call["messages"][0]["content"]
    user = call["messages"][1]["content"]
    assert "=== src/Form.tsx ===" in user and "   5|       <input type=\"text\"" in user
    assert "line 5: label" in user  # static findings are listed so Claude doesn't repeat them
    assert "node_modules" not in user and "README" not in user


def test_claude_finding_on_a_line_the_static_rules_already_flagged_is_not_duplicated(env):
    dup = {"issues": [{"file": "src/Form.tsx", "line": 6, "rule_id": "image-alt", "wcag_sc": "1.1.1", "impact": "critical", "problem": "dup"}]}
    with_claude(env, FakeClaude(dup))
    _, issues, _ = run(env, github()[0])
    assert [i["detector"] for i in issues if i["rule_id"] == "image-alt"] == ["static"]


@pytest.mark.parametrize(
    "fake,note",
    [
        (FakeClaude(refusal="I cannot help with that."), "declined"),
        (FakeClaude("not json"), "not valid JSON"),
        (FakeClaude(error=openai.APIConnectionError(request=httpx.Request("POST", "https://x"))), "failed"),
    ],
)
def test_claude_problems_never_fail_the_scan(env, fake, note):
    with_claude(env, fake)
    scan, issues, events = run(env, github()[0])
    assert scan.status == "done" and {i["detector"] for i in issues} == {"static"}
    assert any(note in e for e in events)


def test_claude_reviews_only_the_first_n_files(env):
    env["cfg"] = Settings(_env_file=None, openai_api_key="k", source_llm_max_files=1, database_url=env["cfg"].database_url)
    fake = FakeClaude({"issues": []})
    env["patch"].setattr(source_llm, "make_client", lambda _s: fake)
    run(env, github()[0])
    user = fake.calls[0]["messages"][1]["content"]
    assert "=== public/index.html ===" in user and "Form.tsx" not in user  # app dirs first, then by path


def test_review_batches_large_file_sets():
    files = {f"f{i}.html": "x" * 30_000 for i in range(5)}
    assert [len(b) for b in source_llm.batches(files)] == [2, 2, 1]


# --- API ----------------------------------------------------------------------------------------------


def test_create_repo_scan_needs_a_repo_and_ignores_the_url(env):
    env["patch"].setattr(pipeline, "start", lambda _id: None)
    with Session(db.engine()) as s:
        out = asyncio.run(routes_scans.create_scan(routes_scans.ScanIn(target="repo", repo="o/r"), s, env["cfg"]))
        assert (out["mode"], out["engine"], out["url"]) == ("source", "source", "https://github.com/o/r")
        with pytest.raises(Exception, match="Enter the repository"):
            asyncio.run(routes_scans.create_scan(routes_scans.ScanIn(target="repo"), s, env["cfg"]))
        with pytest.raises(Exception, match="Enter a website URL"):
            asyncio.run(routes_scans.create_scan(routes_scans.ScanIn(target="site"), s, env["cfg"]))

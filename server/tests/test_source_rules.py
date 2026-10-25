import pytest

from app.source_rules import analyze, is_source_file


def rules(src: str) -> list[tuple[str, int]]:
    return [(f.rule_id, f.line) for f in analyze(src)]


def test_img_alt():
    assert rules('<img src="a.png">') == [("image-alt", 1)]
    assert rules('<img src="a.png" alt="">') == []  # decorative is fine
    assert rules('<img src="a.png" alt={t("logo")} />') == []
    assert rules('<img src="a.png" {...props} />') == []  # a spread may supply alt
    assert rules('<img src="a.png" role="presentation">') == []
    assert rules('<Image src="a.png" />') == []  # components are not checked


def test_line_numbers_and_snippet():
    src = "<div>\n  <p>x</p>\n  <img\n    src='a.png'\n  />\n</div>"
    f = analyze(src)[0]
    assert (f.rule_id, f.line) == ("image-alt", 3)
    assert f.snippet.startswith("<img src='a.png'")


@pytest.mark.parametrize(
    "src,expected",
    [
        ('<input type="text" placeholder="Email">', [("label", 1)]),
        ('<input type="text" aria-label="Email">', []),
        ('<input type="hidden" name="x">', []),
        ('<input type="submit" value="Go">', []),
        ('<label for="e">Email</label><input id="e">', []),
        ('<label htmlFor="e">Email</label><input id="e" />', []),
        ('<label>Email <input type="text"></label>', []),
        ('<label htmlFor={id}>Email</label><input id={id} />', []),
        ('<select name="s"><option>1</option></select>', [("label", 1)]),
        ('<textarea></textarea>', [("label", 1)]),
        ('<input {...register("e")} />', []),
        ('<label for="a">A</label><input id="b">', [("label", 1)]),
    ],
)
def test_form_labels(src, expected):
    assert rules(src) == expected


@pytest.mark.parametrize(
    "src,expected",
    [
        ("<button></button>", [("button-name", 1)]),
        ("<button><svg></svg></button>", [("button-name", 1)]),
        ("<button><Icon /></button>", [("button-name", 1)]),
        ("<button>Save</button>", []),
        ("<button>{label}</button>", []),
        ('<button aria-label="Close"><svg/></button>', []),
        ('<button><img src="x" alt="Close"></button>', []),
        ('<button><span class="sr-only">Close</span><svg/></button>', []),
        ('<a href="/x"></a>', [("link-name", 1)]),
        ('<a href="/x"><img src="x.png"></a>', [("link-name", 1), ("image-alt", 1)]),
        ('<a href="/x">Docs</a>', []),
        ("<a name=\"top\"></a>", []),  # no href: not a link
    ],
)
def test_names(src, expected):
    assert sorted(rules(src)) == sorted(expected)


@pytest.mark.parametrize(
    "src,expected",
    [
        ("<div onClick={go}>x</div>", [("click-events-have-key-events", 1)]),
        ('<div onclick="go()">x</div>', [("click-events-have-key-events", 1)]),
        ('<div role="button" onClick={go}>x</div>', [("click-events-have-key-events", 1)]),
        ('<div role="button" tabIndex={0} onClick={go} onKeyDown={k}>x</div>', []),
        ('<span @click="go">x</span>', [("click-events-have-key-events", 1)]),
        ("<button onClick={go}>x</button>", []),
        ("<div>plain</div>", []),
    ],
)
def test_click_handlers(src, expected):
    assert rules(src) == expected


def test_expressions_with_angle_brackets_and_quotes_do_not_break_parsing():
    src = '<button onClick={() => n > 1 && go("a>b")}>Go</button>\n<img src="x.png">'
    assert rules(src) == [("image-alt", 2)]


def test_html_lang_frames_viewport_tabindex_video():
    page = (
        "<html>\n<head>\n"
        '<meta name="viewport" content="width=device-width, user-scalable=no">\n</head>\n<body>\n'
        '<iframe src="/x"></iframe>\n'
        '<div tabindex="3"></div>\n'
        '<video src="v.mp4" controls></video>\n'
        "</body></html>"
    )
    assert sorted(rules(page)) == sorted([
        ("html-has-lang", 1), ("meta-viewport", 3), ("frame-title", 6), ("tabindex", 7), ("video-caption", 8),
    ])
    assert rules('<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1">') == []
    assert rules('<video src="v.mp4" controls><track kind="captions" src="c.vtt"></video>') == []
    assert rules('<video src="bg.mp4" autoplay muted loop></video>') == []
    assert rules('<iframe title="Map" src="/m"></iframe>') == []
    assert rules('<div tabIndex={0}></div><div tabindex="-1"></div>') == []


def test_clean_page_has_no_findings():
    assert rules('<html lang="en"><body><main><h1>Hi</h1><img src="a" alt="A"><button>Ok</button></main></body></html>') == []


@pytest.mark.parametrize(
    "path,ok",
    [
        ("src/App.tsx", True), ("index.html", True), ("src/App.vue", True), ("src/a.js", False), ("styles.css", False),
        ("node_modules/x/index.html", False), ("src/App.test.tsx", False), ("src/Button.stories.tsx", False),
        ("dist/index.html", False), ("types/global.d.ts", False), ("app/page.tsx", True),
    ],
)
def test_source_file_filter(path, ok):
    assert is_source_file(path) is ok

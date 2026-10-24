"""Manual integration script: running this creates a real branch and PR.

Install requirements.txt, set GITHUB_TOKEN in your shell, and replace the
repository and file placeholders below with a test repository you own. Its
main branch must contain FILE_PATH with the exact BROKEN_HTML snippet.
"""

import asyncio

from github_service import create_accessibility_pr


OWNER = "YOUR_GITHUB_USERNAME"
REPO = "YOUR_TEST_REPOSITORY"
FILE_PATH = "index.html"
BROKEN_HTML = '<img src="logo.png">'
FIXED_HTML = '<img src="logo.png" alt="company logo">'


async def main() -> None:
    if OWNER == "YOUR_GITHUB_USERNAME" or REPO == "YOUR_TEST_REPOSITORY":
        raise ValueError("Set OWNER, REPO, and FILE_PATH to your test repository.")
    pr_url = await create_accessibility_pr(
        owner=OWNER,
        repo=REPO,
        file_path=FILE_PATH,
        broken_html=BROKEN_HTML,
        fixed_html=FIXED_HTML,
    )
    print(f"Pull request created: {pr_url}")


if __name__ == "__main__":
    asyncio.run(main())

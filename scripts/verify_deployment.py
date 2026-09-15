#!/usr/bin/env python3
"""Check that a running deployment serves exactly the code in the public repository.

Notes are encrypted in the browser, so whoever controls the JavaScript a
deployment serves controls the plaintext. This checks that code without trusting
the deployment: it reads the commit the site says it runs, builds that commit
from the repository itself, and compares every file the site serves byte for
byte. The client build is reproducible, which is what makes the comparison
meaningful.

    scripts/verify_deployment.py https://scrapscache.com

It proves what the site served to this machine, at this moment. It cannot rule
out a deployment that serves different code to different people.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from collections.abc import Iterable, Mapping
from html.parser import HTMLParser
from pathlib import Path

DEFAULT_REPOSITORY = "https://github.com/volturine/scrapscache.git"
BUILD_OUTPUT = Path(".svelte-kit/cloudflare")
# Present in the build output for the platform, never served to a browser.
NOT_SERVED = {"_worker.js", "_headers", "_redirects", "_routes.json", ".assetsignore"}
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class Page(HTMLParser):
    """Scripts and linked resources as a browser's tokenizer sees them. A regex
    is the wrong tool here: markup such as `</script >` is valid HTML, and a check
    for tampering has to read the page the way the browser will run it."""

    def __init__(self, html: str):
        super().__init__(convert_charrefs=True)
        self.scripts: list[tuple[str | None, str]] = []
        self.links: list[str] = []
        self._source: str | None = None
        self._body: list[str] | None = None
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script":
            self._source = values.get("src")
            self._body = []
        elif tag == "link" and values.get("href"):
            self.links.append(values["href"])

    def handle_data(self, data):
        if self._body is not None:
            self._body.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._body is not None:
            self.scripts.append((self._source, "".join(self._body)))
            self._source = None
            self._body = None

# SvelteKit's boot script with its variable parts replaced. Upgrading SvelteKit
# can change this; a mismatch then means "update the template", not "tampered",
# and the script says so.
BOOT_TEMPLATE = (
    "{ __sveltekit_X = { base: new URL(\".\", location).pathname.slice(0, -1)ENV }; "
    "const element = document.currentScript.parentElement; "
    "Promise.all([ import(\"START\"), import(\"APP\") ]).then(([kit, app]) => { "
    "kit.start(app, element); }); }"
)
# Runtime public configuration SvelteKit writes into the boot script when the app
# reads $env/dynamic/public. It is data the server chooses, so it is parsed, not
# pattern-matched, and every value must be one the repository declares.
ENV_RE = re.compile(r", env: (\{.*?\})(?= \};)")
PUBLIC_KEY_RE = re.compile(r"^PUBLIC_[A-Z0-9_]+$")


class Mismatch(Exception):
    pass


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def site_path(reference: str) -> str | None:
    """The root-relative path a same-origin reference points at, or None if it
    leaves the site."""
    if re.match(r"^[a-z][a-z0-9+.-]*:", reference, re.I) or reference.startswith("//"):
        return None
    return "/" + reference.lstrip("./").lstrip("/")


def hash_tree(root: Path) -> dict[str, str]:
    served = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name not in NOT_SERVED:
            served["/" + path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return served


def theme_script(app_html: str) -> str:
    """The inline script the page template carries, as the repository has it."""
    inline = [body for source, body in Page(app_html).scripts if source is None and body.strip()]
    if not inline:
        raise Mismatch("src/app.html has no inline script to compare against")
    return normalize(inline[0])


def declared_public_values(wrangler_config: str) -> set[tuple[str, str]]:
    """Every PUBLIC_* variable the repository sets for any environment."""
    stripped = "\n".join(line for line in wrangler_config.splitlines() if not line.strip().startswith("//"))
    config = json.loads(stripped)
    scopes = [config.get("vars", {})] + [env.get("vars", {}) for env in config.get("env", {}).values()]
    return {(key, value) for vars in scopes for key, value in vars.items() if PUBLIC_KEY_RE.match(key)}


def check_public_env(raw: str, wrangler_config: str) -> list[str]:
    try:
        values = json.loads(raw)
    except json.JSONDecodeError:
        return ["boot script carries public configuration that is not plain JSON"]
    if not isinstance(values, dict):
        return ["boot script public configuration is not an object"]
    declared = declared_public_values(wrangler_config)
    problems = []
    for key, value in values.items():
        if not PUBLIC_KEY_RE.match(key) or not isinstance(value, str):
            problems.append(f"boot script carries unexpected public configuration: {key}")
        elif (key, value) not in declared:
            problems.append(f"boot script sets {key} to a value the repository does not declare")
    return problems


def check_boot_script(
    body: str, expected_assets: Mapping[str, str], wrangler_config: str
) -> list[str]:
    imports = re.findall(r'import\("([^"]+)"\)', body)
    problems = []
    for reference in imports:
        path = site_path(reference)
        if path is None or path not in expected_assets:
            problems.append(f"boot script imports {reference}, which the build does not contain")
    shape = normalize(body)
    shape = re.sub(r"__sveltekit_[A-Za-z0-9]+", "__sveltekit_X", shape)
    env = ENV_RE.search(shape)
    if env:
        problems.extend(check_public_env(env.group(1), wrangler_config))
        shape = shape[: env.start()] + "ENV" + shape[env.end() :]
    else:
        shape = shape.replace("slice(0, -1) };", "slice(0, -1)ENV };", 1)
    if len(imports) == 2:
        shape = shape.replace(imports[0], "START").replace(imports[1], "APP")
    if shape != normalize(BOOT_TEMPLATE):
        problems.append(
            "boot script differs from SvelteKit's template (expected after a SvelteKit upgrade, "
            "otherwise suspicious)"
        )
    return problems


def check_shell(
    html: str, app_html: str, expected_assets: Mapping[str, str], wrangler_config: str
) -> list[str]:
    """Everything the page itself runs or loads must come from the build."""
    problems = []
    inline = []
    parsed = Page(html)
    for source, body in parsed.scripts:
        if source is not None:
            path = site_path(source)
            if path is None or path not in expected_assets:
                problems.append(f"page loads a script the build does not contain: {source}")
        elif body.strip():
            inline.append(body)

    expected_theme = theme_script(app_html)
    theme = [body for body in inline if normalize(body) == expected_theme]
    boot = [body for body in inline if "__sveltekit_" in body]
    unknown = [body for body in inline if body not in theme and body not in boot]
    if len(theme) != 1:
        problems.append("the theme script from src/app.html is missing or altered")
    if len(boot) != 1:
        problems.append("expected exactly one SvelteKit boot script")
    else:
        problems.extend(check_boot_script(boot[0], expected_assets, wrangler_config))
    for body in unknown:
        problems.append(f"page runs an inline script the repository does not: {normalize(body)[:80]}…")

    for reference in parsed.links:
        path = site_path(reference)
        if path is not None and path.startswith("/_app/") and path not in expected_assets:
            problems.append(f"page links an asset the build does not contain: {reference}")
    return problems


def declared_script_sources(svelte_config: str) -> set[str]:
    """The script-src the repository declares, in the form a CSP header carries."""
    match = re.search(r"'script-src'\s*:\s*\[(.*?)\]", svelte_config, re.S)
    if not match:
        raise Mismatch("svelte.config.js declares no script-src to compare against")
    sources = set()
    for value in re.findall(r"'([^']*)'", match.group(1)):
        # SvelteKit quotes keywords in the emitted header; URLs stay bare.
        sources.add(value if "://" in value else f"'{value}'")
    return sources


def check_csp(header: str | None, svelte_config: str) -> list[str]:
    """Any origin allowed to run script here can read the keys, so the served
    policy must allow exactly what the repository declares and nothing more."""
    if not header:
        return ["no Content-Security-Policy header"]
    directives = {
        part.strip().split()[0]: part.strip().split()[1:]
        for part in header.split(";")
        if part.strip()
    }
    served = {source for source in directives.get("script-src", []) if not source.startswith("'nonce-")}
    extra = served - declared_script_sources(svelte_config)
    if extra:
        return [f"script-src allows sources the repository does not declare: {' '.join(sorted(extra))}"]
    return []


def compare(expected: Mapping[str, str], served: Mapping[str, str | None]) -> list[str]:
    problems = []
    for path, digest in expected.items():
        actual = served.get(path)
        if actual is None:
            problems.append(f"missing on the site: {path}")
        elif actual != digest:
            problems.append(f"differs from the build: {path}")
    return problems


def fetch(url: str) -> tuple[bytes, Mapping[str, str]]:
    request = urllib.request.Request(
        url,
        headers={
            "cache-control": "no-cache",
            "user-agent": (
                "Mozilla/5.0 (compatible; ScrapsCacheDeploymentVerifier/1.0; "
                "+https://github.com/volturine/scrapscache)"
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(), {key.lower(): value for key, value in response.headers.items()}


def run(command: Iterable[str], cwd: Path, env: Mapping[str, str] | None = None) -> str:
    import os

    return subprocess.run(
        list(command),
        cwd=cwd,
        env={**os.environ, **(env or {})},
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def build(commit: str, repository: str, workdir: Path) -> Path:
    source = workdir / "source"
    print(f"Building {commit[:12]} from {repository}…", file=sys.stderr)
    run(["git", "clone", "--quiet", repository, str(source)], cwd=workdir)
    run(["git", "checkout", "--quiet", commit], cwd=source)
    expected_node = (source / ".nvmrc").read_text().strip().lstrip("v").split(".")[0]
    actual_node = run(["node", "--version"], cwd=source).lstrip("v").split(".")[0]
    if expected_node != actual_node:
        print(
            f"Warning: repository builds with Node {expected_node}, this machine has {actual_node}. "
            "A mismatch here can make honest builds differ.",
            file=sys.stderr,
        )
    run(["npm", "ci", "--ignore-scripts"], cwd=source)
    run(
        ["npm", "run", "build:cloudflare"],
        cwd=source,
        env={"SCRAPSCACHE_BUILD_VERSION": commit},
    )
    return source


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("site", help="e.g. https://scrapscache.com")
    parser.add_argument("--repository", default=DEFAULT_REPOSITORY)
    args = parser.parse_args(argv)
    site = args.site.rstrip("/")

    version = json.loads(fetch(f"{site}/_app/version.json")[0]).get("version", "")
    if not COMMIT_RE.match(version):
        print(f"The site does not name a commit it was built from (version: {version!r}).")
        return 1
    print(f"Site says it runs commit {version}")

    with tempfile.TemporaryDirectory() as temp:
        source = build(version, args.repository, Path(temp))
        expected = hash_tree(source / BUILD_OUTPUT)
        app_html = (source / "src/app.html").read_text()
        svelte_config = (source / "svelte.config.js").read_text()
        wrangler_config = (source / "wrangler.jsonc").read_text()

        served = {}
        for path in expected:
            try:
                served[path] = hashlib.sha256(fetch(f"{site}{path}")[0]).hexdigest()
            except Exception:
                served[path] = None
        page, headers = fetch(f"{site}/")

    problems = compare(expected, served)
    problems += check_shell(page.decode("utf-8"), app_html, expected, wrangler_config)
    problems += check_csp(headers.get("content-security-policy"), svelte_config)

    if problems:
        print(f"\nNOT VERIFIED — {len(problems)} problem(s):")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"\nVerified: all {len(expected)} served files match commit {version}, and the page runs only that code.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

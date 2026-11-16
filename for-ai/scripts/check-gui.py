from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from runpy import run_path
from subprocess import check_output, run
from sys import stdin
from tempfile import TemporaryDirectory
from threading import Thread
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
LAYOUT_AUDIT = Path(__file__).with_name("gui-layout.js").read_text(encoding="utf-8")
VIEWPORTS = ((320, 640, 100, False), (390, 640, 100, False), (390, 844, 100, False),
             (844, 390, 100, False), (390, 844, 200, False), (390, 844, 100, True),
             (1440, 900, 100, False))


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def measure_views(page, flow):
    samples = {"startup": page.evaluate(LAYOUT_AUDIT)}
    page.locator("#install-app").click()
    flow["expect"](page.locator("#install-dialog")).to_be_visible()
    samples["install dialog"] = page.evaluate(LAYOUT_AUDIT)
    page.keyboard.press("Escape")
    flow["simulation"](page)
    samples["simulation dialog"] = page.evaluate(LAYOUT_AUDIT)
    states = page.locator("#simulation-screen option").evaluate_all("options => options.map(option => option.value)")
    page.keyboard.press("Escape")
    for state in states:
        flow["shortcut"](page, state)
        samples[state] = page.evaluate(LAYOUT_AUDIT)
    for state, fixture in (("breathing", "setup-error"), ("breathing", "old-apk"), ("archive", "kiosk-error")):
        flow["shortcut"](page, state)
        flow["set_fixture"](page, fixture)
        samples[fixture] = page.evaluate(LAYOUT_AUDIT)
        flow["set_fixture"](page, "normal")
    return samples


def check_stretch(matrix):
    narrow, short, tall = (matrix[viewport] for viewport in VIEWPORTS[:3])
    failures = []
    for name, base in short.items():
        smaller, expanded = narrow[name], tall[name]
        if any(sample["problems"] for sample in (smaller, base, expanded)):
            continue
        if base["bodyWidth"] <= smaller["bodyWidth"] + 1 or expanded["bodyHeight"] <= base["bodyHeight"] + 1:
            failures.append(f"{name}: stretch body must adapt to added width and height")
        if base["groups"] > 1 and base["groups"] == expanded["groups"] and expanded["gap"] <= base["gap"] + 1:
            failures.append(f"{name}: distribute added height between the ordered groups")
    return failures


def verify(directory):
    from playwright.sync_api import sync_playwright

    flow = run_path(str(directory / "tools/check-ui.py"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=directory))
    Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    matrix = {}
    violations = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            for viewport in VIEWPORTS:
                width, height, font, spacing = viewport
                page, errors = flow["start_page"](browser, url, width, height)
                if font != 100:
                    page.evaluate("size => document.documentElement.style.fontSize = size + '%'", font)
                if spacing:
                    page.add_style_tag(content="*{line-height:1.5!important;letter-spacing:.12em!important;"
                                              "word-spacing:.16em!important}p{margin-bottom:2em!important}")
                samples = measure_views(page, flow)
                matrix[viewport] = samples
                context = f"{width}x{height}, {font}% text, custom spacing {spacing}"
                for name, result in samples.items():
                    if result["problems"]:
                        violations.append(f"{context}, {name}: " + "; ".join(result["problems"][:4]))
                violations.extend(f"{context}: {error}" for error in errors)
                page.close()
    finally:
        server.shutdown()
        server.server_close()
    violations.extend(check_stretch(matrix))
    if violations:
        print(f"FAIL smartphone GUI gate ({len(violations)} findings)")
        print("\n".join(violations[:16]))
        return 1
    print(f"PASS smartphone GUI gate across {len(matrix)} viewport cases")
    return 0


def verify_ref(ref):
    print(f"Verifying smartphone GUI for {ref}", flush=True)
    archive = check_output(["git", "archive", "--format=zip", ref], cwd=ROOT)
    with TemporaryDirectory(prefix="atmungsraum-gui-") as directory, ZipFile(BytesIO(archive)) as snapshot:
        snapshot.extractall(directory)
        return verify(Path(directory))


def product_changed(candidate, previous, remote):
    if not previous.strip("0"):
        comparison = run(["git", "merge-base", candidate, f"refs/remotes/{remote}/main"],
                         cwd=ROOT, capture_output=True, text=True)
        if comparison.returncode != 0:
            return True
        previous = comparison.stdout.strip()
    diff = run(["git", "diff", "--quiet", previous, candidate, "--", ".",
                ":(exclude)for-ai/**", ":(exclude)tests/**", ":(exclude)tools/**", ":(exclude)*.md"], cwd=ROOT)
    return diff.returncode != 0


def pre_push(remote):
    checked = set()
    for line in stdin:
        _, candidate, remote_ref, previous = line.split()
        if not remote_ref.startswith("refs/heads/") or not candidate.strip("0") or candidate in checked:
            continue
        if not product_changed(candidate, previous, remote):
            continue
        if verify_ref(candidate):
            return 1
        checked.add(candidate)
    return 0


if __name__ == "__main__":
    parser = ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--pre-push", metavar="REMOTE")
    mode.add_argument("--ref")
    args = parser.parse_args()
    if args.pre_push is not None:
        raise SystemExit(pre_push(args.pre_push))
    raise SystemExit(verify_ref(args.ref) if args.ref else verify(ROOT))

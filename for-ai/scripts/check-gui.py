from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
import re
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


def measure_views(page, flow, url, style_text):
    expect = flow["expect"]
    reveal = flow["reveal"]
    samples = {}

    def capture(state):
        panel = page.locator("dialog[open]") if page.locator("dialog[open]").count() else page.locator(".screen:not([hidden])")
        previous = panel.get_by_role("button", name="Vorherige Seite", exact=True)
        following = panel.get_by_role("button", name="Nächste Seite", exact=True)
        expect(panel).to_have_attribute("data-page", re.compile(r"^\d+$"))
        for _ in range(32):
            if not previous.count() or not previous.is_enabled():
                break
            previous.click()
        else:
            raise AssertionError(f"Could not return to the first page for {state}")
        for index in range(32):
            name = state if index == 0 else f"{state} · page {index + 1}"
            samples[name] = page.evaluate(LAYOUT_AUDIT)
            if not following.count() or not following.is_enabled():
                return
            following.click()
        raise AssertionError(f"Pagination did not finish for {state}")

    reveal(page, "#quest-participant")
    capture("startup")
    page.locator("#install-app").click()
    expect(page.locator("#install-dialog")).to_be_visible()
    capture("install dialog")
    page.keyboard.press("Escape")
    flow["simulation"](page)
    capture("simulation dialog")
    page.keyboard.press("Escape")
    reveal(page, "#apk-identity > summary").click()
    capture("APK identity")
    reveal(page, "#apk-identity > summary").click()
    reveal(page, "#quest-participant > summary").click()
    capture("participant")
    reveal(page, "#quest-participant > summary").click()
    reveal(page, "#quest-drive > summary").click()
    capture("drive form")
    reveal(page, "#quest-drive > summary").click()
    flow["set_fixture"](page, "kiosk-error")
    reveal(page, "#quest-settings > summary").click()
    reveal(page, "#kiosk-diagnostics > summary").click()
    expect(reveal(page, "#kiosk-retry")).to_be_visible()
    capture("kiosk-error")
    reveal(page, "#kiosk-retry").click()
    reveal(page, "#quest-settings > summary").click()
    flow["set_fixture"](page, "signal-loss")
    expect(page.locator("#quest-polar-connect")).to_be_enabled()
    capture("polar signal loss")
    flow["set_fixture"](page, "normal")
    expect(page.locator("#quest-polar-status")).to_contain_text("Quest empfängt EKG und Beschleunigungsdaten")
    flow["enter_participant"](page)
    capture("breathing")
    flow["set_fixture"](page, "old-apk")
    expect(reveal(page, "#preview-modes-compatibility")).to_be_visible()
    capture("old-apk")
    flow["set_fixture"](page, "setup-error")
    expect(page.locator("#preview-detail")).to_contain_text("läuft nicht weiter")
    capture("setup-error")
    flow["set_fixture"](page, "normal")
    reveal(page, "#preview-calibrate").click()
    expect(reveal(page, "#preview-progress")).to_be_visible()
    capture("calibration")
    reveal(page, "#preview-polar-fixed").click()
    page.locator("#preview-continue").click()
    capture("scenario selection")
    page.locator("#quest-play").click()
    expect(page.locator("#quest-finish")).to_be_visible()
    capture("session")
    page.locator("#quest-finish").click()
    page.locator("#preview-continue").click()
    expect(reveal(page, "#quest-archives")).to_be_visible()
    capture("archive")
    page.goto(url + "?pairing=1")
    style_text()
    page.locator("#quest-find").click()
    expect(reveal(page, "#quest-pairing-code")).to_be_visible()
    capture("pairing")
    page.goto(url + "#daten")
    style_text()
    expect(page.locator("#data-title")).to_be_visible()
    capture("history")
    return samples


def check_stretch(matrix):
    narrow, short, tall = (matrix[viewport] for viewport in VIEWPORTS[:3])
    failures = []
    for name in narrow.keys() & short.keys() & tall.keys():
        base = short[name]
        smaller, expanded = narrow[name], tall[name]
        if any(sample["problems"] for sample in (smaller, base, expanded)):
            continue
        if base["bodyWidth"] <= smaller["bodyWidth"] + 1 or expanded["bodyHeight"] <= base["bodyHeight"] + 1:
            failures.append(f"{name}: stretch body must adapt to added width and height")
        if base["groups"] > 1 and base["contents"] == expanded["contents"] and expanded["gap"] <= base["gap"] + 1:
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
                def style_text():
                    if font != 100:
                        page.evaluate("size => document.documentElement.style.fontSize = size + '%'", font)
                    if spacing:
                        page.add_style_tag(content="*{line-height:1.5!important;letter-spacing:.12em!important;"
                                                  "word-spacing:.16em!important}p{margin-bottom:2em!important}")
                style_text()
                samples = measure_views(page, flow, url, style_text)
                matrix[viewport] = samples
                context = f"{width}x{height}, {font}% text, custom spacing {spacing}"
                print(f"Checked {context}: {len(samples)} pages", flush=True)
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

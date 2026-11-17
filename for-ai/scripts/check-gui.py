from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler
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


def measure_views(page, flow, url, style_text):
    expect = flow["expect"]
    menu, close = flow["menu"], flow["close_dialog"]
    samples = {}

    def capture(state):
        expect(page.locator("html")).to_have_attribute("data-measurement", "ready", timeout=10000)
        samples[state] = page.evaluate(LAYOUT_AUDIT)

    expect(page.locator("#quest-participant")).to_be_visible()
    capture("startup")
    page.locator("#recordings-open").click()
    capture("recordings on startup")
    close(page)
    page.locator("#tools-open").click()
    capture("settings")
    page.locator("#install-app").click()
    expect(page.locator("#install-dialog")).to_be_visible()
    capture("install dialog")
    close(page)
    flow["simulation"](page)
    capture("simulation dialog")
    close(page)
    for fixture, check, dialog in (("bluetooth-off", "bluetooth", "#bluetooth-dialog"),
                                   ("bridge-off", "bridge", "#bridge-dialog"),
                                   ("no-apk", "apk", "#apk-dialog"),
                                   ("old-apk", "apk", "#apk-dialog"),
                                   ("signal-loss", "polar", "#polar-dialog")):
        flow["set_fixture"](page, fixture)
        flow["diagnose"](page, check, dialog)
        capture(fixture)
        if fixture == "old-apk":
            page.locator("#apk-identity").click()
            expect(page.locator("#apk-identity-dialog")).to_be_visible()
            capture("APK identity")
        close(page)
        flow["set_fixture"](page, "normal")
        expect(page.locator("#check-" + check)).to_have_attribute("data-check", "ok", timeout=15000)
    page.locator("#quest-participant").click()
    capture("participant")
    close(page)
    for opener, state in (("#control-open", "control"), ("#ecg-open", "ECG"), ("#drive-open", "drive form")):
        menu(page, opener)
        capture(state)
        close(page)
    flow["set_fixture"](page, "kiosk-error")
    menu(page, "#check-kiosk")
    expect(page.locator("#kiosk-retry")).to_be_visible()
    capture("kiosk-error")
    page.locator("#kiosk-retry").click()
    expect(page.locator("#check-kiosk")).to_have_attribute("data-check", "ok")
    capture("kiosk recovery")
    close(page)
    flow["enter_participant"](page)
    capture("calibration start")
    flow["set_fixture"](page, "setup-error")
    expect(page.locator("#preview-status")).to_contain_text("breathing audio stopped")
    capture("breathing audio stopped")
    flow["set_fixture"](page, "calibration-fail")
    page.locator("#preview-calibrate").click()
    expect(page.locator("#preview-progress")).to_be_visible()
    capture("calibration collecting")
    flow["set_fixture"](page, "setup-error")
    expect(page.locator("#preview-restart")).to_be_enabled()
    capture("calibration interrupted")
    flow["set_fixture"](page, "calibration-fail")
    page.clock.fast_forward(49000)
    expect(page.locator("#preview-status")).to_contain_text("Calibration failed")
    expect(page.locator("#preview-continue")).to_be_hidden()
    expect(page.locator("#preview-controller")).to_be_hidden()
    capture("calibration failed")
    page.locator("#preview-restart").click()
    expect(page.locator("#preview-progress")).to_be_visible()
    page.clock.fast_forward(49000)
    expect(page.locator("#preview-continue")).to_be_hidden()
    expect(page.locator("#preview-controller")).to_be_enabled()
    capture("calibration failed twice")
    flow["set_fixture"](page, "normal")
    flow["collect_calibration"](page, "#preview-restart")
    expect(page.locator("#preview-controller")).to_be_visible()
    capture("calibration review")
    page.locator("#preview-controller").click()
    expect(page.locator("#preview-status")).to_contain_text("respond to the controller")
    capture("controller review")
    page.locator("#preview-continue").click()
    capture("scenario selection")
    page.locator("#quest-play").click()
    expect(page.locator("#quest-play")).to_have_text("Pause")
    expect(page.locator("#scene-particles")).to_be_visible()
    capture("session")
    page.locator("#quest-play").click()
    expect(page.locator("#quest-play")).to_have_text("Fortsetzen")
    capture("paused session")
    flow["set_fixture"](page, "signal-loss")
    expect(page.locator("#scene-breath-phase")).to_have_text("Kein Atemsignal")
    capture("session without breath signal")
    flow["set_fixture"](page, "normal")
    page.locator("#quest-finish").click()
    page.locator("#preview-continue").click()
    page.locator("#recordings-open").click()
    expect(page.locator("#quest-archives")).to_be_visible()
    capture("archive")
    page.goto(url + "?pairing=1")
    style_text()
    page.locator("#quest-find").click()
    expect(page.locator("#quest-pairing-code")).to_be_visible()
    capture("pairing")
    page.goto(url + "#daten")
    style_text()
    expect(page.locator("#data-title")).to_be_visible()
    expect(page.locator('#corner-actions .check-icon[data-check="unconfirmed"]:visible')).to_have_count(4)
    capture("history")
    for view, selector in (("participant", "#participant-dialog[open]"), ("calibration", "#preview-calibrate"),
                           ("scenarios", "#session-choices"), ("session", "#quest-playback")):
        page.goto(url + "?view=" + view)
        style_text()
        expect(page.locator(selector)).to_be_visible()
        capture("review link: " + view)
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
    server = flow["AuditServer"](("127.0.0.1", 0), partial(QuietHandler, directory=directory))
    Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    matrix = {}
    violations = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            for viewport in VIEWPORTS:
                width, height, font, spacing = viewport
                page, errors = flow["start_page"](browser, url, width, height, clock=True)
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
                print(f"Checked {context}: {len(samples)} screens and dialogs", flush=True)
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

from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def simulation(page):
    page.locator("#simulation-open").click()
    expect(page.locator("#simulation-dialog")).to_be_visible()


def set_fixture(page, value):
    simulation(page)
    page.locator("#simulation-state").select_option(value)
    page.keyboard.press("Escape")
    expect(page.locator("#simulation-open")).to_be_focused()


def layout_check(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert page.evaluate("""() => [...document.querySelectorAll(
        '.screen:not([hidden]) button, dialog[open] button, dialog[open] select, #corner-actions button'
      )].filter(element => element.getClientRects().length).every(element => {
        const box = element.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1
          && element.scrollWidth <= element.clientWidth + 2;
      })""")
    expect(page.locator("html")).to_have_attribute("data-measurement", "ready")


def start_page(browser, url, width=390, height=844):
    page = browser.new_page(viewport={"width": width, "height": height}, accept_downloads=True)
    page.clock.install()
    origin = urlsplit(url).netloc
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("requestfailed", lambda req: errors.append(req.url + " " + str(req.failure)))
    page.on("response", lambda res: errors.append(str(res.status) + " " + res.url) if res.status >= 400 else None)
    page.on("request", lambda req: errors.append("External request " + req.url)
            if urlsplit(req.url).scheme in ("http", "https") and urlsplit(req.url).netloc != origin else None)
    page.add_init_script("addEventListener('beforeinstallprompt', e => e.stopImmediatePropagation(), true)")
    assert page.goto(url, wait_until="networkidle").ok
    expect(page.locator("html")).to_have_attribute("data-measurement", "ready")
    expect(page.locator('#quest-title[data-text-measurement="pretext"]')).to_be_visible()
    return page, errors


def enter_participant(page):
    page.locator("#quest-participant summary").press("Enter")
    page.locator("#patient-surname").fill("tes")
    page.locator("#patient-age").fill("30")
    page.locator('[name=gender][value=other]').check()
    expect(page.locator("#patient-id")).to_have_text("Tes_30_O")
    page.locator("#patient-next").press("Enter")
    expect(page.locator("#breathing-preview")).to_be_visible()
    expect(page.locator("#preview-title")).to_be_focused()


def check_pairing(browser, url):
    pairing_url = urlsplit(url)._replace(query="pairing=1", fragment="").geturl()
    page, errors = start_page(browser, pairing_url)
    page.locator("#quest-find").click()
    expect(page.locator("#quest-pairing-code")).to_have_text(re.compile(r"^\d{6}$"))
    page.locator("#quest-pairing-confirm").click()
    expect(page.locator("#quest-participant")).to_be_visible()
    expect(page.locator("#quest-control-release")).to_be_visible()
    assert not errors, errors
    page.close()


def full_flow(browser, url, image):
    page, errors = start_page(browser, url)
    page.locator("#install-app").click()
    expect(page.locator("#install-dialog")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#install-app")).to_be_focused()
    expect(page.locator("#quest-control-release")).to_be_visible()
    expect(page.locator("#quest-find")).to_be_hidden()
    page.locator("#quest-control-release").click()
    expect(page.locator("#quest-participant")).to_be_hidden()
    page.locator("#quest-control-claim").click()
    expect(page.locator("#quest-participant")).to_be_visible()
    page.locator("#recenter-vr").click()
    expect(page.locator("#quest-status")).to_have_text("VR-Szene zentriert.")
    expect(page.locator("#quest-polar-connect")).to_be_disabled()
    expect(page.locator("#quest-clock")).to_have_text("00:00")
    expect(page.locator("#quest-ecg")).to_be_visible()
    set_fixture(page, "signal-gap")
    page.wait_for_function("document.querySelector('#quest-ecg-trace').getAttribute('d').match(/M/g)?.length > 1")
    set_fixture(page, "signal-loss")
    expect(page.locator("#quest-ecg")).to_be_hidden()
    page.locator("#quest-polar-connect").click()
    expect(page.locator("#quest-ecg")).to_be_visible()
    set_fixture(page, "polar-off")
    page.locator("#quest-polar-connect").click()
    expect(page.locator("#quest-ecg")).to_be_visible()
    set_fixture(page, "kiosk-error")
    page.locator("#quest-settings > summary").click()
    page.locator("#kiosk-retry").click()
    expect(page.locator("#kiosk-summary")).to_contain_text(" · wirksam")
    page.locator("#quest-settings > summary").click()
    page.locator("#quest-drive > summary").click()
    page.locator("#quest-drive-connect").click()
    expect(page.locator("#quest-drive-status")).to_contain_text("Google Drive verbunden")
    enter_participant(page)
    expect(page.locator("#preview-start")).to_be_hidden()
    expect(page.locator("#preview-continue")).to_be_disabled()
    expect(page.locator("#preview-status")).to_have_text("Automatic ist bereit.")
    page.locator("#preview-calibrate").click()
    expect(page.locator("#preview-actual-circle")).to_be_visible()
    expect(page.locator("#preview-progress")).to_be_visible()
    page.clock.fast_forward(49000)
    expect(page.locator("#preview-input-label")).to_contain_text("persönlich eingerichtet")
    page.locator("#preview-polar-fixed").click()
    expect(page.locator("#preview-title")).to_have_text("Polar STATE testen")
    expect(page.locator("#preview-polar-fixed")).to_have_attribute("aria-pressed", "true")
    page.locator("#preview-polar-adaptive").click()
    expect(page.locator("#preview-polar-adaptive")).to_have_attribute("aria-pressed", "true")
    set_fixture(page, "old-apk")
    expect(page.locator("#preview-polar-adaptive")).to_be_hidden()
    expect(page.locator("#apk-update-status")).to_contain_text("Update")
    set_fixture(page, "setup-error")
    page.locator("#preview-controller").click()
    expect(page.locator("#preview-recovery")).to_be_visible()
    expect(page.locator("#preview-recovery")).to_be_hidden()
    expect(page.locator("#preview-title")).to_have_text("Controller testen")
    if image:
        page.screenshot(path=image, full_page=True)
    page.locator("#preview-continue").click()
    expect(page.locator("#quest-condition")).to_be_focused()
    page.locator("#quest-scenario").select_option("haupt-15")
    simulation(page)
    page.locator("#simulation-speed").select_option("60")
    page.keyboard.press("Escape")
    play = page.locator("#quest-play")
    play.click()
    expect(play).to_have_text("Pause")
    expect(page.locator("#quest-disconnect")).to_be_hidden()
    expect(page.locator("#quest-polar")).to_be_hidden()
    expect(page.locator("#quest-drive-status")).to_have_text("Google Drive empfängt die laufende Aufnahme.", timeout=10000)
    minute, second = map(int, page.locator("#quest-clock").inner_text().split(":"))
    assert minute * 60 + second > 0
    play.click()
    expect(play).to_have_text("Fortsetzen")
    paused = page.locator("#quest-clock").inner_text()
    page.clock.fast_forward(2500)
    assert page.locator("#quest-clock").inner_text() == paused
    play.click()
    expect(play).to_have_text("Pause")
    page.locator("#quest-finish").click()
    expect(page.locator("#breathing-preview")).to_be_visible()
    page.locator("#preview-continue").click()
    expect(page.locator("#quest-archives")).to_be_visible()
    expect(page.locator("#quest-drive-status")).to_have_text("In Google Drive bestätigt: 1", timeout=15000)
    with page.expect_download() as pending:
        page.locator("#quest-export-download").click()
    assert re.fullmatch(r"Dem_30_O_\d{4}-\d{2}-\d{2}_haupt-15_r1\.csv", pending.value.suggested_filename)
    exported = pending.value.path().read_text(encoding="utf-8")
    assert exported.startswith("source,sample_index,time_s,ecg_mock_uv\nmock-neurokit2,")
    assert "Tes_30_O" not in exported
    simulation(page)
    page.locator("#simulation-reset").click()
    expect(page.locator("#quest-ecg")).to_be_visible()
    expect(page.locator("#patient-surname")).to_have_value("")
    assert not errors, errors
    page.close()


def matrix(browser, url):
    for width, height, font, spacing in [(320, 640, 100, False), (390, 844, 200, False),
                                          (844, 390, 100, False), (390, 844, 100, True),
                                          (1440, 900, 100, False)]:
        page, errors = start_page(browser, url, width, height)
        if font != 100:
            page.evaluate("size => document.documentElement.style.fontSize = size + '%'", font)
        if spacing:
            page.add_style_tag(content="* {line-height:1.5 !important; letter-spacing:.12em !important;"
                                       "word-spacing:.16em !important} p {margin-bottom:2em !important}")
        expect(page.locator("#quest-participant")).to_be_visible()
        layout_check(page)
        simulation(page)
        layout_check(page)
        page.keyboard.press("Escape")
        enter_participant(page)
        layout_check(page)
        page.locator("#preview-polar-fixed").click()
        page.locator("#preview-continue").click()
        layout_check(page)
        page.locator("#quest-play").click()
        expect(page.locator("#quest-play")).to_have_text("Pause")
        layout_check(page)
        assert not errors, errors
        print(f"PASS rendered {width}x{height}, {font}% text, custom spacing {spacing}, connected workflow")
        page.close()


def main():
    parser = ArgumentParser()
    parser.add_argument("--url")
    parser.add_argument("--image")
    args = parser.parse_args()
    server = None
    url = args.url
    if not url:
        directory = Path(__file__).resolve().parents[1]
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=directory))
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            check_pairing(browser, url)
            full_flow(browser, url, args.image)
            print("PASS pairing, control, Polar commands and ECG, breathing receipts, kiosk, live/final Drive transfer and CSV")
            matrix(browser, url)
    finally:
        if server:
            server.shutdown()


if __name__ == "__main__":
    main()

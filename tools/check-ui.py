from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
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


def shortcut(page, screen):
    simulation(page)
    page.locator("#simulation-screen").select_option(screen)
    expect(page.locator("#simulation-dialog")).to_be_hidden()


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


def full_flow(browser, url, image):
    page, errors = start_page(browser, url)
    page.clock.install()
    page.locator("#install-app").click()
    expect(page.locator("#install-dialog")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#install-app")).to_be_focused()
    page.locator("#quest-find").click()
    expect(page.locator("#quest-pairing-code")).to_have_text("481 620")
    page.locator("#quest-pairing-confirm").click()
    page.locator("#quest-control-claim").click()
    page.locator("#patient-surname").fill("dem")
    page.locator("#patient-age").fill("30")
    page.locator('[name=gender][value=other]').check()
    expect(page.locator("#patient-id")).to_have_text("Dem_30_O")
    page.locator("#patient-next").click()
    page.locator("#quest-polar-connect").click()
    expect(page.locator("#quest-ecg")).to_be_visible()
    expect(page.locator("#quest-ecg-status")).to_contain_text("NeuroKit2")
    wave = page.locator("#quest-ecg-trace").get_attribute("d")
    page.clock.run_for(500)
    assert page.locator("#quest-ecg-trace").get_attribute("d") != wave
    set_fixture(page, "signal-gap")
    page.clock.run_for(4500)
    expect(page.locator("#quest-ecg")).to_be_visible()
    set_fixture(page, "signal-loss")
    expect(page.locator("#quest-ecg")).to_be_hidden()
    expect(page.locator("#quest-play")).to_be_disabled()
    page.locator("#quest-polar-connect").click()
    expect(page.locator("#quest-ecg")).to_be_visible()
    page.locator("#quest-play").click()
    expect(page.locator("#breathing-preview")).to_be_visible()
    page.locator("#preview-start").click()
    expect(page.locator("#preview-actual-circle")).to_be_visible()
    page.locator("#preview-calibrate").click()
    expect(page.locator("#preview-progress")).to_be_visible()
    page.clock.run_for(49000)
    expect(page.locator("#preview-input-label")).to_contain_text("Persönlich")
    page.locator("#preview-polar-fixed").click()
    expect(page.locator("#preview-polar-fixed")).to_have_attribute("aria-pressed", "true")
    page.locator("#preview-polar-adaptive").click()
    expect(page.locator("#preview-polar-adaptive")).to_have_attribute("aria-pressed", "true")
    set_fixture(page, "old-apk")
    expect(page.locator("#preview-polar-adaptive")).to_be_hidden()
    expect(page.locator("#apk-update-status")).to_contain_text("aktualisieren")
    set_fixture(page, "setup-error")
    expect(page.locator("#preview-recovery")).to_be_visible()
    page.locator("#preview-acknowledge").click()
    expect(page.locator("#preview-recovery")).to_be_hidden()
    page.locator("#preview-controller").click()
    expect(page.locator("#preview-title")).to_have_text("Controller testen")
    if image:
        page.screenshot(path=image, full_page=True)
    page.locator("#preview-continue").click()
    page.locator("#quest-scenario").select_option("haupt-15")
    simulation(page)
    page.locator("#simulation-speed").select_option("60")
    page.keyboard.press("Escape")
    play = page.locator("#quest-play")
    expect(play).to_be_enabled()
    page.clock.pause_at(page.evaluate("Date.now()") + 100)
    play.evaluate("button => button.click()")
    page.clock.run_for(1500)
    minute, second = map(int, page.locator("#quest-clock").inner_text().split(":"))
    # At 60x, the last drawn frame can be one displayed second behind.
    assert 89 <= minute * 60 + second <= 90
    play.evaluate("button => button.click()")
    paused = page.locator("#quest-clock").inner_text()
    page.clock.run_for(2500)
    assert page.locator("#quest-clock").inner_text() == paused
    play.evaluate("button => button.click()")
    page.clock.run_for(16000)
    page.clock.resume()
    expect(page.locator("#quest-archives")).to_be_visible()
    set_fixture(page, "kiosk-error")
    page.locator("#quest-settings > summary").click()
    expect(page.locator("#kiosk-retry")).to_be_visible()
    page.locator("#kiosk-retry").click()
    expect(page.locator("#kiosk-summary")).to_have_text("Kiosk-Schutz aktiv.")
    with page.expect_download() as pending:
        page.locator("#quest-export-download").click()
    assert pending.value.suggested_filename == "SIM_Dem_30_O_EKG.csv"
    assert pending.value.path().read_text(encoding="utf-8").startswith("source,sample_index,time_s,ecg_mock_uv\nmock-neurokit2,")
    shortcut(page, "history")
    expect(page.locator("#data-files a")).to_have_count(1)
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
        for screen in ("pairing", "participant", "polar", "breathing", "session", "archive", "history"):
            simulation(page)
            layout_check(page)
            page.locator("#simulation-screen").select_option(screen)
            expect(page.locator("#simulation-dialog")).to_be_hidden()
            layout_check(page)
        assert not errors, errors
        print(f"PASS rendered {width}x{height}, {font}% text, custom spacing {spacing}, seven screens")
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
            full_flow(browser, url, args.image)
            print("PASS pairing, participant form, ECG replay/loss, calibration/modes, session clock, kiosk and synthetic CSV")
            matrix(browser, url)
    finally:
        if server:
            server.shutdown()


if __name__ == "__main__":
    main()

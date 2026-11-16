from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def reveal(page, selector):
    target = page.locator(selector)
    for _ in range(32):
        page.evaluate("() => new Promise(requestAnimationFrame)")
        state = page.wait_for_function("""selector => {
            const panel = document.querySelector('dialog[open], .screen:not([hidden])');
            const element = document.querySelector(selector);
            if (!element) return null;
            if (element.closest('details:not([open])') && !element.closest('summary') && !element.matches('details')) return null;
            const item = element.closest('[data-page-index]') ?? element.querySelector('[data-page-index]');
            if ((!element.closest('.screen-body') || item)
              && element.getClientRects().length && element.checkVisibility()) {
                if (element.matches(':is(input, textarea):enabled')) element.focus({ preventScroll: true });
                return 'visible';
            }
            if (!item || !panel?.contains(item) || item.closest('[hidden]')) return null;
            const current = Number(panel.dataset.page);
            const wanted = Number(item.dataset.pageIndex);
            if (current === wanted) return null;
            return current < wanted ? 'Nächste Seite' : 'Vorherige Seite';
        }""", arg=selector).json_value()
        if state == "visible":
            return target
        panel = page.locator("dialog[open]") if page.locator("dialog[open]").count() else page.locator(".screen:not([hidden])")
        panel.get_by_role("button", name=state, exact=True).click()
    raise AssertionError(f"Unable to reach {selector} through the page controls")


def simulation(page):
    reveal(page, "#simulation-open").click()
    expect(page.locator("#simulation-dialog")).to_be_visible()


def set_fixture(page, value):
    simulation(page)
    reveal(page, "#simulation-state").select_option(value)
    page.keyboard.press("Escape")
    expect(page.locator("#simulation-open")).to_be_focused()


def layout_check(page):
    dimensions = page.evaluate("""async () => {
      for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
      const root = document.documentElement;
      const panel = document.querySelector('dialog[open], .screen:not([hidden])');
      return {horizontal: root.scrollWidth - innerWidth, vertical: root.scrollHeight - innerHeight,
        panel: panel?.id, no_fit: panel?.dataset.noFit};
    }""")
    assert dimensions["horizontal"] <= 0 and dimensions["vertical"] <= 0 and not dimensions.get("no_fit"), dimensions
    assert page.evaluate("""() => [...document.querySelectorAll(
        '.screen:not([hidden]) button, dialog[open] button, dialog[open] select, #corner-actions button'
      )].filter(element => element.getClientRects().length).every(element => {
        const box = element.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1
          && element.scrollWidth <= element.clientWidth + 2;
      })""")
    expect(page.locator("html")).to_have_attribute("data-measurement", "ready")


def start_page(browser, url, width=390, height=844, clock=False):
    page = browser.new_page(viewport={"width": width, "height": height}, accept_downloads=True)
    if clock:
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
    try:
        expect(page.locator("html")).to_have_attribute("data-measurement", "ready")
    except AssertionError as error:
        raise AssertionError(f"Pretext startup failed. Browser errors: {errors}") from error
    expect(page.locator('#quest-title[data-text-measurement="pretext"]')).to_be_visible()
    return page, errors


def enter_participant(page):
    if page.locator("#quest-participant").get_attribute("open") is None:
        reveal(page, "#quest-participant summary").press("Enter")
    reveal(page, "#patient-surname").fill("tes")
    reveal(page, "#patient-age").fill("30")
    reveal(page, '[name=gender][value=other]').check()
    expect(page.locator("#patient-id")).to_have_text("Tes_30_O")
    reveal(page, "#patient-next").press("Enter")
    expect(page.locator("#breathing-preview")).to_be_visible()
    expect(page.locator("#preview-title")).to_be_focused()


def check_pairing(browser, url):
    pairing_url = urlsplit(url)._replace(query="pairing=1", fragment="").geturl()
    page, errors = start_page(browser, pairing_url)
    reveal(page, "#quest-find").click()
    expect(page.locator("#quest-pairing-code")).to_have_text(re.compile(r"^\d{6}$"))
    reveal(page, "#quest-pairing-confirm").click()
    expect(reveal(page, "#quest-participant")).to_be_visible()
    expect(reveal(page, "#quest-control-release")).to_be_visible()
    assert not errors, errors
    page.close()


def check_reduced_viewport(browser, url):
    page, errors = start_page(browser, url)
    reveal(page, "#quest-participant summary").press("Enter")
    submit = reveal(page, "#patient-next")
    expect(submit).to_be_enabled()
    submit.press("Enter")
    surname = page.locator("#patient-surname")
    expect(surname).to_be_focused()
    surname.fill("tes")
    page.set_viewport_size({"width": 390, "height": 340})
    expect(page.locator("html")).to_have_attribute("data-short-viewport", "")
    expect(surname).to_be_focused()
    expect(surname).to_have_value("tes")
    layout_check(page)
    assert not errors, errors
    page.close()


def full_flow(browser, url, image):
    page, errors = start_page(browser, url, clock=True)
    reveal(page, "#install-app").click()
    expect(page.locator("#install-dialog")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#install-app")).to_be_focused()
    expect(reveal(page, "#quest-control-release")).to_be_visible()
    expect(page.locator("#quest-find")).to_be_hidden()
    reveal(page, "#quest-control-release").click()
    expect(page.locator("#quest-participant")).to_be_hidden()
    reveal(page, "#quest-control-claim").click()
    expect(reveal(page, "#quest-participant")).to_be_visible()
    reveal(page, "#recenter-vr").click()
    expect(page.locator("#quest-status")).to_have_text("VR-Szene zentriert.")
    expect(page.locator("#quest-polar-connect")).to_be_disabled()
    expect(page.locator("#quest-clock")).to_have_text("00:00")
    expect(reveal(page, "#quest-ecg")).to_be_visible()
    set_fixture(page, "signal-gap")
    page.wait_for_function("document.querySelector('#quest-ecg-trace').getAttribute('d').match(/M/g)?.length > 1")
    set_fixture(page, "signal-loss")
    expect(page.locator("#quest-ecg")).to_be_hidden()
    reveal(page, "#quest-polar-connect").click()
    expect(reveal(page, "#quest-ecg")).to_be_visible()
    set_fixture(page, "polar-off")
    reveal(page, "#quest-polar-connect").click()
    expect(reveal(page, "#quest-ecg")).to_be_visible()
    set_fixture(page, "kiosk-error")
    reveal(page, "#quest-settings > summary").click()
    reveal(page, "#kiosk-retry").click()
    expect(page.locator("#kiosk-summary")).to_contain_text(" · wirksam")
    reveal(page, "#quest-settings > summary").click()
    reveal(page, "#quest-drive > summary").click()
    reveal(page, "#quest-drive-connect").click()
    expect(page.locator("#quest-drive-status")).to_contain_text("Google Drive verbunden")
    enter_participant(page)
    expect(page.locator("#preview-start")).to_be_hidden()
    expect(page.locator("#preview-continue")).to_be_disabled()
    expect(page.locator("#preview-status")).to_have_text("Automatic ist bereit.")
    reveal(page, "#preview-calibrate").click()
    expect(reveal(page, "#preview-actual-circle")).to_be_visible()
    expect(reveal(page, "#preview-progress")).to_be_visible()
    page.clock.fast_forward(49000)
    expect(page.locator("#preview-input-label")).to_contain_text("persönlich eingerichtet")
    reveal(page, "#preview-polar-fixed").click()
    expect(page.locator("#preview-title")).to_have_text("Polar STATE testen")
    expect(page.locator("#preview-polar-fixed")).to_have_attribute("aria-pressed", "true")
    reveal(page, "#preview-polar-adaptive").click()
    expect(page.locator("#preview-polar-adaptive")).to_have_attribute("aria-pressed", "true")
    set_fixture(page, "old-apk")
    expect(page.locator("#preview-polar-adaptive")).to_be_hidden()
    expect(page.locator("#apk-update-status")).to_contain_text("Update")
    set_fixture(page, "setup-error")
    reveal(page, "#preview-controller").click()
    expect(reveal(page, "#preview-recovery")).to_be_visible()
    expect(page.locator("#preview-recovery")).to_be_hidden()
    expect(page.locator("#preview-title")).to_have_text("Controller testen")
    if image:
        page.screenshot(path=image, full_page=True)
    reveal(page, "#preview-continue").click()
    expect(page.locator("#quest-condition")).to_be_focused()
    reveal(page, "#quest-scenario").select_option("haupt-15")
    simulation(page)
    reveal(page, "#simulation-speed").select_option("60")
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
    reveal(page, "#quest-finish").click()
    expect(page.locator("#breathing-preview")).to_be_visible()
    reveal(page, "#preview-continue").click()
    expect(reveal(page, "#quest-archives")).to_be_visible()
    expect(page.locator("#quest-drive-status")).to_have_text("In Google Drive bestätigt: 1", timeout=15000)
    with page.expect_download() as pending:
        reveal(page, "#quest-export-download").click()
    assert re.fullmatch(r"Dem_30_O_\d{4}-\d{2}-\d{2}_haupt-15_r1\.csv", pending.value.suggested_filename)
    exported = pending.value.path().read_text(encoding="utf-8")
    assert exported.startswith("source,sample_index,time_s,ecg_mock_uv\nmock-neurokit2,")
    assert "Tes_30_O" not in exported
    simulation(page)
    reveal(page, "#simulation-reset").click()
    expect(reveal(page, "#quest-ecg")).to_be_visible()
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
        expect(reveal(page, "#quest-participant")).to_be_visible()
        layout_check(page)
        simulation(page)
        layout_check(page)
        page.keyboard.press("Escape")
        enter_participant(page)
        layout_check(page)
        reveal(page, "#preview-polar-fixed").click()
        reveal(page, "#preview-continue").click()
        layout_check(page)
        reveal(page, "#quest-play").click()
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
            check_reduced_viewport(browser, url)
            full_flow(browser, url, args.image)
            print("PASS pairing, control, Polar commands and ECG, breathing receipts, kiosk, live/final Drive transfer and CSV")
            matrix(browser, url)
    finally:
        if server:
            server.shutdown()


if __name__ == "__main__":
    main()

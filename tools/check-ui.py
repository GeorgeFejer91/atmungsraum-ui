from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


class AuditServer(ThreadingHTTPServer):
    # Chromium requests the module graph concurrently.
    request_queue_size = 64


def menu(page, selector):
    page.locator("#tools-open").click()
    page.locator(selector).click()


def close_dialog(page):
    dialog = page.locator("dialog[open]")
    expect(dialog).to_have_count(1)
    page.keyboard.press("Escape")
    expect(dialog).to_have_count(0)


def simulation(page):
    menu(page, "#simulation-open")
    expect(page.locator("#simulation-dialog")).to_be_visible()


def set_fixture(page, value):
    simulation(page)
    page.locator("#simulation-state").select_option(value)
    close_dialog(page)


def diagnose(page, check, dialog):
    icon = page.locator("#check-" + check)
    expect(icon).to_have_attribute("data-check", "unconfirmed", timeout=15000)
    icon.click()
    expect(page.locator(dialog)).to_be_visible()


def collect_calibration(page, button="#preview-calibrate"):
    page.locator(button).click()
    expect(page.locator("#preview-progress")).to_be_visible()
    expect(page.locator("#preview-continue")).to_be_hidden()
    expect(page.locator("#preview-actual-circle")).to_be_visible()
    page.clock.fast_forward(49000)
    expect(page.locator("#preview-continue")).to_be_enabled()


def layout_check(page):
    assert not page.locator(".viewport-navigation, [data-page-index]").count()
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
    page.locator("#quest-participant").press("Enter")
    expect(page.locator("#participant-dialog")).to_be_visible()
    page.locator("#patient-surname").fill("tes")
    page.locator("#patient-age").fill("30")
    page.locator("#patient-gender").select_option("other")
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
    expect(page.locator("#check-bridge")).to_have_attribute("data-check", "ok")
    assert not errors, errors
    page.close()


def check_review_links(browser, url):
    suffixes = (
        ("connection", "#quest-participant"), ("participant", "#participant-dialog[open]"),
        ("calibration", "#preview-calibrate"), ("scenarios", "#session-choices"), ("session", "#quest-playback"),
    )
    for view, selector in suffixes:
        page = browser.new_page(viewport={"width": 390, "height": 844})
        assert page.goto(urlsplit(url)._replace(query=f"view={view}", fragment="").geturl()).ok
        expect(page.locator(selector)).to_be_visible(timeout=5000)
        if view == "participant":
            expect(page.locator("#patient-surname")).to_be_focused()
            close_dialog(page)
            expect(page.locator("#quest-participant")).to_be_focused()
        if view == "scenarios":
            expect(page.get_by_role("radio")).to_have_count(3)
        if view == "session":
            expect(page.locator("#quest-clock")).to_have_text("00:00 / 15:00")
            expect(page.locator("#quest-play")).to_have_text("Starten")
        layout_check(page)
        page.close()


def check_scene_particles(browser, url):
    session_url = urlsplit(url)._replace(query="view=session", fragment="").geturl()
    page, errors = start_page(browser, session_url, clock=True)
    preview = page.get_by_role("figure", name="Partikelvorschau")
    canvas = page.locator("#scene-particle-canvas")
    phase = page.locator("#scene-breath-phase")
    play = page.locator("#quest-play")

    def diameter():
        return canvas.evaluate("""canvas => {
          const { width, height } = canvas;
          const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
          let left = width, right = -1;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i]) {
              const x = ((i - 3) / 4) % width;
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
          return Math.max(0, right - left + 1);
        }""")

    expect(preview).to_be_hidden()
    play.click()
    expect(preview).to_be_visible(timeout=5000)
    expect(phase).to_have_text("Einatmen")
    initial = diameter()
    assert initial > 0
    page.clock.fast_forward(4100)
    expect(phase).to_have_text("Halten")
    expanded = diameter()
    assert expanded > initial + 20, (initial, expanded)
    page.clock.fast_forward(5800)
    expect(phase).to_have_text("Ausatmen")
    assert diameter() < expanded - 20
    play.click()
    expect(play).to_have_text("Fortsetzen")
    frozen = canvas.evaluate("canvas => canvas.toDataURL()")
    page.clock.fast_forward(4500)
    assert canvas.evaluate("canvas => canvas.toDataURL()") == frozen
    play.click()
    expect(play).to_have_text("Pause")
    set_fixture(page, "signal-loss")
    expect(phase).to_have_text("Kein Atemsignal")
    assert diameter() == 0
    set_fixture(page, "normal")
    expect(phase).to_have_text(re.compile(r"Einatmen|Halten|Ausatmen"))
    page.emulate_media(reduced_motion="reduce")
    page.clock.fast_forward(500)
    still = canvas.evaluate("canvas => canvas.toDataURL()")
    page.clock.fast_forward(5000)
    assert canvas.evaluate("canvas => canvas.toDataURL()") == still
    page.locator("#quest-finish").click()
    expect(preview).to_be_hidden()
    assert not errors, errors
    page.close()


def check_playback(browser, url):
    page = browser.new_page()
    page.add_init_script("""(() => {
      window.playedCues = [];
      const create = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = create.call(this);
        const analyser = this.createAnalyser();
        source.connect(analyser);
        const start = source.start.bind(source);
        source.start = (...args) => {
          start(...args);
          const observation = { offset: args[1], start: args[0], duration: args[2],
            ended: false, audible: () => {
              const samples = new Float32Array(analyser.fftSize);
              analyser.getFloatTimeDomainData(samples);
              return samples.some(sample => Math.abs(sample) > 0.001);
            } };
          source.addEventListener('ended', () => observation.ended = true);
          window.playedCues.push(observation);
        };
        return source;
      };
    })()""")
    assert page.goto(url).ok
    enter_participant(page)
    expect(page.locator("#preview-calibrate")).to_be_enabled()
    assert page.evaluate("playedCues.length") == 0
    page.locator("#preview-calibrate").click()
    page.wait_for_function("playedCues[0]?.audible()", timeout=10000)
    set_fixture(page, "setup-error")
    page.wait_for_function("playedCues.every(cue => cue.ended)")
    before = page.evaluate("playedCues.length")
    page.locator("#preview-restart").click()
    page.wait_for_function("before => playedCues[before]?.audible()", arg=before, timeout=10000)

    assert page.goto(urlsplit(url)._replace(query="view=session").geturl()).ok
    play = page.locator("#quest-play")
    expect(play).to_have_text("Starten")
    assert page.evaluate("playedCues.length") == 0
    play.click()
    page.wait_for_function("playedCues[0]?.audible()", timeout=10000)
    page.wait_for_function("playedCues[4]?.audible()", timeout=20000)
    assert page.evaluate("playedCues.slice(0, 5).map(cue => Math.floor(cue.offset / 4) * 4)") == [0, 64, 28, 68, 4]
    assert page.evaluate("playedCues.slice(1, 5).every((cue, i) => "
                         "Math.abs(cue.start - (playedCues[0].start + playedCues[0].duration + i * 4)) < .01)")
    play.click()
    expect(play).to_have_text("Fortsetzen")
    page.wait_for_function("playedCues.every(cue => cue.ended)")
    before = page.evaluate("playedCues.length")
    play.click()
    page.wait_for_function("before => playedCues[before]?.offset > playedCues[4].offset", arg=before)
    page.locator("#quest-finish").click()
    page.wait_for_function("playedCues.every(cue => cue.ended)")
    page.close()


def check_reduced_viewport(browser, url):
    page, errors = start_page(browser, url)
    page.locator("#quest-participant").press("Enter")
    submit = page.locator("#patient-next")
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


def check_diagnostics(page):
    for name in ("bluetooth", "bridge", "apk", "polar"):
        icon = page.locator("#check-" + name)
        expect(icon).to_have_attribute("data-check", "ok")
        expect(icon).to_be_disabled()
        expect(icon).to_have_css("color", "rgb(129, 233, 164)")
    page.wait_for_function("""() => [...document.querySelectorAll('#corner-actions .check-icon svg use')]
      .every(icon => icon.getBBox().width > 0)""")
    for fixture, check, dialog, feedback, match in (
        ("bluetooth-off", "bluetooth", "#bluetooth-dialog", "#bluetooth-feedback", "nicht gefunden"),
        ("bridge-off", "bridge", "#bridge-dialog", "#bridge-feedback", re.compile(r"nicht erreichbar|keine bestätigten")),
        ("no-apk", "apk", "#apk-dialog", "#apk-installed", "nicht bestätigt"),
        ("old-apk", "apk", "#apk-dialog", "#apk-update-status", "Update"),
    ):
        set_fixture(page, fixture)
        expect(page.locator(feedback)).to_be_hidden()
        diagnose(page, check, dialog)
        expect(page.locator("#check-" + check)).to_have_css("color", "rgb(255, 143, 143)")
        expect(page.locator(feedback)).to_contain_text(match)
        close_dialog(page)
        expect(page.locator("#check-" + check)).to_be_focused()
        set_fixture(page, "normal")
        expect(page.locator("#check-" + check)).to_have_attribute("data-check", "ok", timeout=15000)


def full_flow(browser, url, image):
    page, errors = start_page(browser, url, clock=True)
    check_diagnostics(page)
    settings = page.get_by_role("button", name="Einstellungen", exact=True)
    settings.press("Enter")
    expect(page.get_by_role("dialog", name="Einstellungen")).to_be_visible()
    close_dialog(page)
    expect(settings).to_be_focused()
    recordings = page.get_by_role("button", name="Aufnahmen", exact=True)
    page.keyboard.press("Tab")
    expect(recordings).to_be_focused()
    page.keyboard.press("Space")
    expect(page.get_by_role("dialog", name="Aufnahmen")).to_be_visible()
    close_dialog(page)
    expect(recordings).to_be_focused()
    menu(page, "#install-app")
    expect(page.locator("#install-dialog")).to_be_visible()
    close_dialog(page)
    expect(page.locator("#tools-open")).to_be_focused()
    menu(page, "#control-open")
    page.locator("#quest-control-release").click()
    expect(page.locator("#quest-participant")).to_be_hidden()
    page.locator("#quest-control-claim").click()
    close_dialog(page)
    expect(page.locator("#quest-participant")).to_be_visible()
    page.locator("#recenter-vr").click()
    expect(page.locator("#quest-status")).to_have_text("VR-Szene zentriert.")
    expect(page.locator("#quest-clock")).to_be_hidden()
    menu(page, "#ecg-open")
    expect(page.locator("#quest-ecg")).to_be_visible()
    close_dialog(page)
    set_fixture(page, "signal-gap")
    page.wait_for_function("document.querySelector('#quest-ecg-trace').getAttribute('d').match(/M/g)?.length > 1")
    for fixture in ("signal-loss", "polar-off"):
        set_fixture(page, fixture)
        diagnose(page, "polar", "#polar-dialog")
        page.locator("#quest-polar-connect").click()
        expect(page.locator("#check-polar")).to_have_attribute("data-check", "ok")
        close_dialog(page)
    set_fixture(page, "kiosk-error")
    menu(page, "#check-kiosk")
    expect(page.locator("#kiosk-dialog")).to_be_visible()
    page.locator("#kiosk-retry").click()
    expect(page.locator("#kiosk-summary")).to_contain_text(" · wirksam")
    close_dialog(page)
    menu(page, "#drive-open")
    page.locator("#quest-drive-connect").click()
    expect(page.locator("#quest-drive-status")).to_contain_text("Google Drive verbunden")
    close_dialog(page)
    enter_participant(page)
    actions = page.locator("#breathing-preview button:visible")
    expect(actions).to_have_text(["Start Calibration"], timeout=3000)
    expect(page.locator(".preview-radius")).to_be_hidden()
    collect_calibration(page)
    expect(page.get_by_text("Bitte fragen Sie die teilnehmende Person, ob die Partikel auf ihre Atmung reagieren.")).to_be_visible()
    expect(actions).to_have_text(["Accept Calibration", "Restart Calibration"])
    expect(page.locator("#preview-continue")).to_be_focused()
    collect_calibration(page, "#preview-restart")
    expect(actions).to_have_text(["Accept Calibration", "Restart Calibration", "Switch to Controller based Breath Measure"])
    set_fixture(page, "setup-error")
    page.locator("#preview-controller").click()
    expect(page.locator("#preview-continue")).to_be_hidden()
    expect(page.locator("#preview-continue")).to_be_visible()
    expect(page.locator("#preview-status")).to_contain_text("controller")
    expect(actions).to_have_text(["Accept Calibration", "Restart Calibration"])
    page.locator("#preview-continue").click()
    expect(page.get_by_role("radio")).to_have_count(3)
    practice = page.get_by_role("radio", name="Probe-Runde")
    exploration = page.get_by_role("radio", name="Freie Erkundung")
    main_study = page.get_by_role("radio", name="Haupt-Runde")
    expect(practice).to_be_focused()
    page.keyboard.press("ArrowRight")
    expect(exploration).to_be_checked()
    expect(exploration).to_be_focused()
    if image:
        page.screenshot(path=image, full_page=True)
    page.keyboard.press("ArrowRight")
    expect(main_study).to_be_checked()
    simulation(page)
    page.locator("#simulation-speed").select_option("60")
    close_dialog(page)
    play = page.locator("#quest-play")
    play.click()
    expect(play).to_have_text("Pause")
    progress = page.get_by_role("progressbar", name="Szenariofortschritt")
    expect(progress).to_be_visible()
    expect(progress).to_have_attribute("max", "900000")
    expect(page.locator("#quest-drive-status")).to_have_text("Google Drive empfängt die laufende Aufnahme.", timeout=10000)
    expect(page.locator("#quest-clock")).to_have_text(re.compile(r"^\d{2}:\d{2} / 15:00$"))
    minute, second = map(int, page.locator("#quest-clock").inner_text().split(" / ")[0].split(":"))
    assert minute * 60 + second > 0
    assert 0 < progress.evaluate("bar => bar.position") < 1
    play.click()
    expect(play).to_have_text("Fortsetzen")
    paused = page.locator("#quest-clock").inner_text()
    paused_value = progress.evaluate("bar => bar.value")
    page.clock.fast_forward(2500)
    assert page.locator("#quest-clock").inner_text() == paused
    expect(progress).to_have_js_property("value", paused_value)
    play.click()
    expect(play).to_have_text("Pause")
    page.wait_for_function("paused => document.querySelector('#quest-progress').value > paused", arg=paused_value)
    page.locator("#quest-finish").click()
    expect(page.locator("#breathing-preview")).to_be_visible()
    expect(progress).to_be_hidden()
    page.locator("#preview-continue").click()
    expect(page.locator("#quest-drive-status")).to_have_text("In Google Drive bestätigt: 1", timeout=15000)
    recordings.click()
    expect(page.locator("#quest-archives")).to_be_visible()
    with page.expect_download() as pending:
        page.locator("#quest-export-download").click()
    assert re.fullmatch(r"Dem_30_O_\d{4}-\d{2}-\d{2}_haupt-15_r1\.csv", pending.value.suggested_filename)
    exported = pending.value.path().read_text(encoding="utf-8")
    assert exported.startswith("source,sample_index,time_s,ecg_mock_uv\nmock-neurokit2,")
    assert "Tes_30_O" not in exported
    close_dialog(page)
    exploration.check()
    play.click()
    expect(play).to_have_text("Pause")
    expect(progress).to_be_hidden()
    page.clock.fast_forward(22000)
    expect(page.locator("#quest-clock")).to_have_text(re.compile(r"^(2[1-9]|[3-9]\d):\d\d$"))
    page.locator("#quest-finish").click()
    expect(page.locator("#breathing-preview")).to_be_visible()
    page.locator("#preview-continue").click()
    recordings.click()
    archives = page.locator("#quest-archives")
    expect(archives.locator("option")).to_have_count(2, timeout=15000)
    archives.select_option(index=0)
    expect(page.locator("#quest-export-download")).to_have_attribute(
        "download", re.compile(r"_free-exploration_r2\.csv$"))
    with page.expect_download() as pending:
        page.locator("#quest-export-download").click()
    assert re.fullmatch(r"Dem_30_O_\d{4}-\d{2}-\d{2}_free-exploration_r2\.csv", pending.value.suggested_filename)
    close_dialog(page)
    page.locator("#quest-participant").click()
    page.locator("#patient-surname").fill("neue")
    page.locator("#patient-next").click()
    expect(actions).to_have_text(["Start Calibration"])
    collect_calibration(page)
    expect(actions).to_have_text(["Accept Calibration", "Restart Calibration"])
    simulation(page)
    page.locator("#simulation-reset").click()
    expect(page.locator("#check-polar")).to_have_attribute("data-check", "ok")
    expect(page.locator("#patient-surname")).to_have_value("")
    assert not errors, errors
    page.close()


def matrix(browser, url):
    for width, height, font, spacing in [(320, 640, 100, False), (390, 844, 200, False),
                                          (844, 390, 100, False), (390, 844, 100, True),
                                          (1440, 900, 100, False)]:
        page, errors = start_page(browser, url, width, height, clock=True)
        if font != 100:
            page.evaluate("size => document.documentElement.style.fontSize = size + '%'", font)
        if spacing:
            page.add_style_tag(content="* {line-height:1.5 !important; letter-spacing:.12em !important;"
                                       "word-spacing:.16em !important} p {margin-bottom:2em !important}")
        expect(page.locator("#quest-participant")).to_be_visible()
        layout_check(page)
        simulation(page)
        layout_check(page)
        close_dialog(page)
        enter_participant(page)
        layout_check(page)
        collect_calibration(page)
        page.locator("#preview-continue").click()
        layout_check(page)
        page.locator("#quest-play").click()
        expect(page.locator("#quest-play")).to_have_text("Pause")
        layout_check(page)
        assert not errors, errors
        print(f"PASS rendered {width}x{height}, {font}% text, custom spacing {spacing}, single-screen workflow")
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

        server = AuditServer(("127.0.0.1", 0), partial(QuietHandler, directory=directory))
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            check_review_links(browser, url)
            check_scene_particles(browser, url)
            print("PASS particle expansion, contraction, pause, signal loss, and reduced motion", flush=True)
            check_playback(browser, url)
            print("PASS direct review URLs and audible calibration/session playback with recovery and pause/resume", flush=True)
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

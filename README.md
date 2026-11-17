# Atmungsraum UI playground

[Open the live smartphone UI](https://georgefejer91.github.io/atmungsraum-ui/).

Open a fresh demo directly at the screen you want to review:

| Screen | Review link |
| --- | --- |
| Connection and setup | [Connected](https://georgefejer91.github.io/atmungsraum-ui/?view=connection) · [Pairing](https://georgefejer91.github.io/atmungsraum-ui/?pairing=1) |
| Participant ID | [Teilnehmer-ID](https://georgefejer91.github.io/atmungsraum-ui/?view=participant) |
| Breathing calibration | [Breathing Calibration](https://georgefejer91.github.io/atmungsraum-ui/?view=calibration) |
| Scenario selection | [Szenarioauswahl](https://georgefejer91.github.io/atmungsraum-ui/?view=scenarios) |
| Session controls | [Haupt-Runde ready to start](https://georgefejer91.github.io/atmungsraum-ui/?view=session) |
| Earlier browser recordings | [Frühere Browser-Aufnahmen](https://georgefejer91.github.io/atmungsraum-ui/#daten) |

These entry points are also listed under **Simulation → Einstieg**. The
calibration, scenario and session links use a fictional participant to skip
earlier steps. The session link opens a prepared run at 00:00 and waits for
**Starten**.

The playground opens with the Quest connected, this smartphone in control, and
both Polar H10 streams ready. Enter and confirm a test participant ID to open
breathing setup. **Start Calibration** plays a 44-second German instruction
([transcript](assets/audio/calibration-prelude.txt)), then starts the box breathing
cues and shows calibration progress. **Cancel Instructions** stops the intro
before any calibration data is collected. **Restart Calibration** retries the
breathing cycles directly. Verify the particle response with the participant, then
accept or restart. After two Polar attempts the operator can also switch to a VR
controller and check its response. Accepting opens a single page with three
illustrated scenario tiles: **Probe-Runde** (instruction plus five minutes
of guided breathing), **Freie Erkundung** (instruction plus 7:05 of free
breathing), and **Haupt-Runde** (15 minutes, one fixed condition). Start,
pause, resume, and end the run using the app's controls. Each scenario shows
a progress bar and elapsed versus total time. Saved runs offer a synthetic
CSV download.

During playback, **Partikelvorschau** shows a small coupled particle sphere
driven by the simulated Polar breathing signal. It expands during inhale,
holds, and contracts during exhale. Pause freezes the sphere. If the breathing
signal drops, the window shows **Kein Atemsignal**. Reduced motion keeps a
static sphere with the current phase label.

Open **Simulation** to try Quest pairing, disconnect the Polar, drop its ECG
signal, exercise a failed calibration, audio recovery or an older APK state,
accelerate the run clock, or return to the connected starting state.

Each step and popup fits on one screen. The Bluetooth, WLAN bridge, Quest app,
and Polar H10 icons are white during checks, green on confirmation, and red
when a check fails. Press a red icon to see diagnostic feedback. The menu
opens controls for recordings, live ECG, Drive, and the simulation.

Use fictional inputs. The entered participant ID stays in the audit tab and
exports use a fixed synthetic identity. The original UI controller and clients
exchange signed or encrypted Quest messages with an in-page backend. Recording
lists, manifests, and checksummed chunks use the original synchronization code
and a dedicated browser cache. The Drive form uses a preset audit account for
simulated authorization and resumable uploads. The mock device and Drive
service start fresh when the page reloads. Browser requests stay on the page's origin.

## ECG fixture

The shared test signal is the original Atmungsraum NeuroKit2 ECGSYN trace.
It has 30 minutes of seeded data at 256 Hz with a nominal heart rate of 70 bpm.
The browser verifies the SHA-256 in [the manifest](assets/ecg/mock-ecg.json)
and replays it on the existing ECG view at a simulated 130 Hz. Voltage units
are display-scaled and synthetic. The respiratory state and VR radius are
separate deterministic fixtures.
[NeuroKit2 ECG simulation](https://neuropsychology.github.io/NeuroKit/functions/ecg.html#neurokit2.ecg_simulate)

## Breathing audio

The playground rotates through the main study's seven inhale, nine exhale and
two hold takes. Each phase lasts four seconds. The recorded inhale and exhale
sounds from Proton Drive play beneath the corresponding German counts.
[Voice takes](https://github.com/GeorgeFejer91/viscereality.org/tree/574a43359266de733eeb44d70e740e05c86f0922/atmungsraum/assets/audio/main-study/de)
· [Breath recording provenance](https://github.com/GeorgeFejer91/viscereality.org/blob/96713eed1cf43ea8940d17ca727fd9f318d8900e/atmungsraum/assets/audio/box-breathing/de/soft-v2/manifest.json)

Playback begins on a calibration or session action. Probe-Runde and Haupt-Runde
use the guided cues at normal speed. Accelerated runs are silent. A connected
Quest owns its own audio.

**Freie Erkundung** plays the German instruction, then fades in the supplied
background music over three seconds. The music plays once for 7:05; the 7:27
run ends automatically when the track ends.

**Haupt-Runde** opens with the eyes-closed and eyes-open breathing checks,
then the [German box-breathing instructions](assets/audio/main-study-instructions.txt).
Each control lasts 2:07.339 and has pauses for listening to natural breathing,
noticing the inhale and exhale, returning attention, and continuing to listen.
The controls and instructions take exactly five minutes together. Guided
breathing runs from 5:00 to 15:00, with 37 complete cycles followed by a
four-second inhale and a four-second exhale. The recorded outro plays after
the timer ends.
If the audio fails to load, select **Starten** again.

## Edit and check

- Edit `index.html` and `style.css` for shared screen structure and styling.
- `app.js` owns Pretext measurement and the usable viewport size.
  `connectivity.js` displays the background check results.
  `playground.js` injects the mock discovery,
  Quest, and Drive services into the original controller. `mock-quest.js`,
  `mock-protocol.js`, `mock-recordings.js`, and `mock-drive.js` own the responses.
  `vendor/atmungsraum/` contains the original controller and clients. Its
  integration changes cover injected services, session storage, calibration
  presentation, shared renderer paths, review entry points, and the audit
  recording cache. `playground-audio.js` schedules the breathing cues from
  [the cue catalog](assets/audio/main-study-cues.json) and the narration from
  [the main-study timeline](assets/audio/main-study-timeline.js). Regenerate
  the audio banks with `node tools/build-preview-audio.mjs <main project atmungsraum directory>`
  using FFmpeg and the main project checkout containing the source takes.
- Serve the folder with `python -m http.server 8000`. Run `pnpm test` for
  deterministic data and audio file integrity checks and `python tools/check-ui.py`
  for the Chrome and Playwright browser checks. The latter accepts `--url` for
  deployed checks.
- Pages publishes the root of `main`. The committed Pretext runtime is used
  directly. Restore it with `pnpm install --frozen-lockfile` and `pnpm run vendor`.

## Port design changes upstream

The source baseline is [Atmungsraum at 3f8d7c8](https://github.com/GeorgeFejer91/viscereality.org/tree/3f8d7c8befa3c13d1e8f574e82082468ba5128f7/atmungsraum).
Start with `git diff ui-playground-baseline -- index.html style.css app.js live-ecg-display.js live-breath-display.js`.
Apply the relevant UI hunks to the matching files under `atmungsraum/` in
the main project. Preserve production IDs and accessibility attributes or
update their owners together. The Simulation panel, fixture controller, sample
files, and playground manifest belong to this repository. Run the production
render and controller checks on the port before merging.

# Atmungsraum UI playground

[Open the live smartphone UI](https://georgefejer91.github.io/atmungsraum-ui/).

The playground opens with the Quest connected, this smartphone in control, and
both Polar H10 streams ready. Enter and confirm a test participant ID to open
breathing setup. Choose an input and verify the preview, then select a condition
and scenario. Start, pause, resume, and end the run using the app's controls.
Saved runs offer a synthetic CSV download.

Open **Simulation** to try Quest pairing, disconnect the Polar, drop its ECG
signal, exercise recovery or an older APK state, accelerate the clock, or return
to the connected starting state.

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
separate deterministic fixtures. [NeuroKit2 ECG simulation](https://neuropsychology.github.io/NeuroKit/functions/ecg.html#neurokit2.ecg_simulate)

## Edit and check

- Edit `index.html` and `style.css` for shared screen structure and styling.
- `app.js` owns Pretext measurement. `playground.js` injects the mock discovery,
  Quest, and Drive services into the original controller. `mock-quest.js`,
  `mock-protocol.js`, `mock-recordings.js`, and `mock-drive.js` own the responses.
  `vendor/atmungsraum/` contains the original controller and clients. Its
  integration changes are limited to injected services, session storage,
  shared renderer paths, and the audit recording cache.
- Serve the folder with `python -m http.server 8000`. Run `pnpm test` for
  deterministic data checks and `python tools/check-ui.py` for the Chrome and
  Playwright browser checks. The latter accepts `--url` for deployed checks.
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

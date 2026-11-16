# Atmungsraum UI playground

[Open the live smartphone UI](https://georgefejer91.github.io/atmungsraum-ui/).

The playground preserves the German Atmungsraum screens for independent design
work. Walk through smartphone pairing, participant entry, Polar setup, breathing
preview, a practice or main run, and synthetic CSV download. Open **Simulation**
to jump to a screen, introduce ECG gaps or signal loss, exercise setup/kiosk
recovery or an older APK state, accelerate the session clock, or reset.

Use fictional inputs. Participant and connection fields exist solely to exercise
the UI and live in the current page. All downloads use a fixed synthetic identity.
The app runs from static files and requests only its own assets.

## ECG fixture

The shared test signal is the original Atmungsraum NeuroKit2 ECGSYN trace.
It has 30 minutes of seeded data at 256 Hz with a nominal heart rate of 70 bpm.
The browser verifies the SHA-256 in [the manifest](assets/ecg/mock-ecg.json)
and replays it on the existing ECG view at a simulated 130 Hz. Voltage units
are display-scaled and synthetic. The respiratory state and VR radius are
separate deterministic fixtures. [NeuroKit2 ECG simulation](https://neuropsychology.github.io/NeuroKit/functions/ecg.html#neurokit2.ecg_simulate)

## Edit and check

- Edit `index.html` and `style.css` for shared screen structure and styling.
- Edit `app.js` for Pretext measurement. `playground.js` and `simulation.js`
  own mock behavior. `live-ecg-display.js` and `live-breath-display.js` are the
  shared presentation modules.
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

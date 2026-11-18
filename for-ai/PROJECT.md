# Project contract

## Purpose

Provide a stand-alone smartphone PWA playground for the Atmungsraum operator
flow, from connecting the Quest through running a VR scenario. The playground
uses a synthetic ECG feed and simulated devices, with alternate states in the
Simulation menu.

## Target PWA flow

1. **Connection and setup.** Start on the page that establishes the PWA's
   Bluetooth and Wi-Fi connections to the Quest. Put all setup buttons on this
   page, including device setup, app installation, and Google Drive. Once both
   Quest connections are confirmed, display the participant's live ECG on this
   page and enable **Weiter**.
2. **Teilnehmer-ID.** Enter or select and confirm the participant ID on its own
   page. The confirmed ID determines how the run's recordings are named.
3. **ACC breathing calibration.** Start the German instruction from one
   action, then begin the guided box breathing loop and Polar calibration
   when the instruction ends. Keep the circles visible at review and
   ask the operator to confirm the participant sees the particles respond.
   **Accept Calibration** advances once the Quest reports a ready input.
   **Restart Calibration** retries, and the controller option appears after
   two Quest-reported Polar attempts for the current participant setup.
4. **VR scenario and session.** Group two illustrated options under
   **Probe-Runde**: **Geführte Atmung** (instruction plus five minutes of
   guided breathing) and **Freie Erkundung** (instruction plus 7:05 of
   unguided breathing). Show **Haupt-Runde** (15 minutes, one fixed condition)
   separately on the same page. Select an option and press
   **Starten**. Timed runs show elapsed and total time and a progress bar above
   the pause and end controls. The bar holds while paused.
5. **Haupt-Runde questionnaire.** In the same browser, show one of five
   required questions at a time after the simulated recorder verifies
   natural main completion. Save a separate JSON file with the synthetic
   recording's participant ID and session UUID, and exercise its upload
   through the existing mock Drive. See the [direct review link](../README.md).

The current build starts in the simulated connected state and opens the
participant form as a dialog. Its fixture exports use a fixed demo identity.

### Open flow decisions

- Decide whether the connection page also waits for live Polar H10 data before
  enabling **Weiter**. Define how operators retry pairing or calibration and
  where they resume if a connection drops later.
- Decide what operators see after saving a run, how production recordings are
  named across repeat runs, and how to start another run or switch participants.

## Active checklist

- [x] Pin the existing German UI and keep the HTML IDs, CSS and shared renderers.
- [x] Implement mock pairing, control ownership, participant form, Polar and ECG,
  breathing setup, session controls, kiosk status and synthetic downloads.
- [x] Reuse the original seeded NeuroKit2 fixture with a hash check.
- [x] Verify the complete browser flow and the responsive layout matrix.
- [x] Verify the exact GitHub Pages deployment.
- [x] Verify the pinned original controller against the simulated Quest and Drive
  protocols in local Chrome, including pairing, command receipts, ECG, live and
  finalized recording transfers, and the synthetic CSV download.
- [x] Meet the single-viewport contract in the strict Chrome audit. The
  [smartphone GUI release gate](./VERIFICATION.md#smartphone-gui-release-gate)
  passed 25 screens and dialogs across seven viewport cases, including 200%
  text and text spacing overrides.
  The browser flow also preserves keyboard focus during a reduced-height
  viewport test.
- [x] Simplify the calibration page to start, review, retry, and controller
  fallback. Chrome verified the review gate, interrupted audio, two failed
  attempts, controller selection, and reset for a new participant. The strict
  audit passed 29 states across seven viewport cases using simulated signals.
- [x] Consolidate VR scenario selection into three illustrated square tiles.
  Chrome verified keyboard selection, the fixed main condition, an untimed
  exploration run, and the synthetic downloads. The strict viewport audit
  checks that the tile labels and SVGs fit.
- [x] Show progress for timed scenarios. Chrome verified pause and resume,
  the untimed exploration display, automatic completion of the practice run,
  and layout fit across the seven viewport cases of the strict audit.
- [x] Put **Einstellungen** and **Aufnahmen** in the top bar as grey SVG icon
  boxes. Keep the full top row visible on every screen and above dialogs.
  Chrome verified direct access, keyboard activation, return focus, and
  single-row fit in the strict seven-viewport audit.
- [x] Add [direct review links](../README.md) for the main views and play the
  original Quest breathing loop during calibration and real-time timed runs.
  Chrome verified direct links, rendered audio, recovery, pause and resume.
  The strict audit passed 34 states across seven viewport cases.
- [x] Use the main project's four-second inhale and exhale mixes in the
  playground. The Proton Drive originals match the upstream source hashes.
  Chrome confirmed the breath layer between counts on both phases.
- [x] Rotate the newer main-study voice pool through the preview. The decoded
  cues retain the original recorded breath layer under each inhale and exhale.
  Chrome verified the phase boundaries, change of take, and pause and resume.
- [x] Show a coupled particle sphere during scene playback. Chrome verified
  expansion, contraction, pause, missing signal and reduced motion. At a
  320 × 640 emulated viewport, the draw loop ran at 23.8 updates per second
  with 0.2 ms per update at the 95th percentile across 101 updates.
- [x] Play both control recordings and the box-breathing instruction in five
  minutes. Run ten minutes of guided breathing and play the outro after the timer.
  Chrome verifies playback, pause, resume and automatic end.
- [x] Play the German instruction before the first calibration attempt and
  offer its transcript. Chrome verified playback completion, cancellation,
  transcript download, and retry without replaying the instruction. The strict
  audit passed 39 states across seven viewport cases, including unavailable audio.
- [x] Replace the instruction between the breathing checks and the guided
  cycles with the supplied recording. Test a slow or failed audio download
  with inline loading and retry feedback. The strict Chrome audit passed
  41 states across seven viewport cases.
- [x] Play the supplied instruction and music in Freie Erkundung. Chrome
  verified the handoff, pause and resume, and automatic completion. The
  strict audit passed 42 states across seven viewport cases.
- [x] Group Geführte Atmung and Freie Erkundung under Probe-Runde. Chrome
  verified keyboard selection, and the strict audit passed 42 states across
  seven viewport cases.
- [x] Port the smartphone questionnaire and add a completed main-run review entry.
  The ordinary scenario route and the direct entry use verified mock v4 data.
  Browser checks cover empty fields, Back, separate downloads, early finish,
  practice exclusion, and automatic delivery to the mock Drive. The exact
  [Pages run 44293408066](https://github.com/GeorgeFejer91/atmungsraum-ui/actions/runs/44293408066)
  deployed main at da6985b. Eleven public assets match Git. The public direct
  review and ordinary completion flow pass in Chrome, and the exact commit
  passes the seven-viewport GUI gate and all eight Node tests.
- [ ] Implement the [target PWA flow](#target-pwa-flow). Start with the dedicated
  connection page and verify the **Weiter** gate in connected and failed states.

## Smartphone GUI design rules

1. Fit every step that waits for user input into one smartphone viewport,
   including forms, dialogs, and overlays. Fit every field, label, status, action, and
   focus indicator for that state inside the usable visual viewport. Account
   for safe areas, browser chrome, and the on-screen keyboard during input.
2. The document and every app-authored region must have zero horizontal and
   vertical scroll range. Fit must hold while navigating, editing, opening a
   dialog, and moving focus. Keep user zoom and text enlargement available.
   Clipped content, hidden scrollbar chrome, and scrolling to reach a control
   each fail the contract.
3. Use `uncodixfy-pretext` and its outside-in accordion stretch layout for all
   app screens and dialogs. Allocate the usable shell first, reserve header
   and action anchors, and keep label-field pairs and control groups in reading
   and focus order. Distribute surplus space between groups and cells along
   both axes with shrinkable Grid or Flex tracks. Derive spacing and preferred
   type from width and height while preserving readable type, visible focus,
   and usable touch targets. Let nested forms and groups use the space allocated
   to them. Use balanced outer insets, shared label and control tracks within
   each row, and equal cell sizes for controls with the same role. A wrapped
   label expands the shared label track. Use extra space to separate the
   ordered groups and balance the form within its body.
4. Use the locked `@chenglou/pretext` dependency through the existing
   measurement owner. Measure every bounded text region against its actual
   inner width and height with matching loaded fonts, spacing, and locale.
   Confirm the painted result. Keep each step's complete input and actions
   visible together. Use task-specific dialogs for optional controls.
   Every resulting view must fit with full readable text and controls.
5. Show background checks as neutral black-and-white SVG icons while checking,
   green on confirmation and red on failure. Each red icon opens one diagnostic
   popup. Keep diagnostic feedback inside that popup and omit generic page arrows.
   Keep the checks and grey action boxes aligned in one top row. Open dialogs
   below that row so the connection indicators stay visible.

## Ownership

Static HTML/CSS and JavaScript at the repository root. `app.js` owns
Pretext measurement and usable viewport sizing. `connectivity.js` projects
background check results into diagnostic icons. `playground.js` wires the
original operator controller and clients in `vendor/atmungsraum/` to the in-page Quest, recording, and Drive
backends. The transport exercises the clients' signed and encrypted message
validation. Discovery returns synthetic metadata. Recordings use a fixed demo
identity and a dedicated browser cache. Requests stay on the page's origin.
`playground-audio.js` follows the simulated playback state and the Quest loop's
four-phase timing. It rotates through the newer main-study voice takes and
plays the recorded breath sound beneath each inhale and exhale cue.
The playground also plays the supplied German calibration instruction. The
controller waits for playback to end before sending the first calibration
command. Cancelled or unavailable audio leaves calibration unstarted; retries
after a calibration attempt go straight to the breathing cycles.
The 15-minute Haupt-Runde opens with equal eyes-closed and eyes-open controls,
then the supplied German box-breathing instruction. Prompts in the controls
resume at the same elapsed times after quiet periods for attending to breath.
The opening lasts five minutes. Guided breathing runs for ten minutes and ends
with a four-second inhale and a four-second exhale after 37 full cycles. The
outro plays after the timer ends at normal speed. Audio and the particle
preview share the main-study timeline and simulated elapsed time.
Freie Erkundung plays a 21.786-second instruction and then 425.284 seconds of
background music with a three-second fade at the start of the music. Its timer
includes both clips and ends the run when the music ends. It uses no guided
breathing cues.
At normal speed the playground loads the audio before dispatching Start.
The session status shows loading or allows retry if the audio is unavailable.
`scene-particles.js` draws 72 particles from the simulated Polar breathing
signal. The radius follows the Quest configuration's 1 to 2 metre range in
proportion, with sine-shaped transitions and both holds. The view caps
animation at 24 updates per second and stops drawing when paused or hidden.
See [README](../README.md) for transferring design changes to the original app.

Upstream visuals are pinned to `3f8d7c8befa3c13d1e8f574e82082468ba5128f7`.
The ECG binary and generator come from the original Atmungsraum work at
`1a8057234a69bbfec40ca937983f036b7d8df5e0`. The manifest records the seed,
versions and checksum. No ECG data was acquired from a person.

The `ui-playground-baseline` tag names the first release at `4283741`.
[Pages run 43866774013](https://github.com/GeorgeFejer91/atmungsraum-ui/actions/runs/43866774013)
deployed that exact commit from `main`. Fifteen public files matched Git.
All three Node tests passed locally. The Chrome flow and seven-screen layout
matrix passed locally and on Pages at 320px, 200% text, narrow landscape,
custom text spacing, and desktop size. Checks used synthetic state and files.

The Pages evidence above applies to the baseline release. The local browser
flow and responsive smoke checks pass for the protocol-backed audit fixture.
Port only intended presentation changes to the original app. Physical-phone
installation and production hardware acceptance remain separate.

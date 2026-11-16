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
3. **ACC breathing calibration.** Start the guided box breathing loop and
   Polar calibration from one action. Keep the circles visible at review and
   ask the operator to confirm the participant sees the particles respond.
   **Accept Calibration** advances once the Quest reports a ready input.
   **Restart Calibration** retries, and the controller option appears after
   two Quest-reported Polar attempts for the current participant setup.
4. **Round selection.** Choose **Haupt-Runde** or **Probe-Runde** on a dedicated
   page.
5. **VR scenarios.** Show the scenario pages for the chosen round.

The current build starts in the simulated connected state and opens the
participant form as a dialog. Its fixture exports use a fixed demo identity.

### Open flow decisions

- Decide whether the connection page also waits for live Polar H10 data before
  enabling **Weiter**. Define how operators retry pairing or calibration and
  where they resume if a connection drops later.
- Map VR conditions A/B, instructions, practice durations, and Box-Atmung to
  the two round branches.
- Define where Start, Pause, Resume, and End belong in the scenario pages. Decide
  what operators see after saving a run, how recordings are named across repeat
  runs, and how to start another run or switch participants.

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

## Ownership

Static HTML/CSS and JavaScript at the repository root. `app.js` owns
Pretext measurement and usable viewport sizing. `connectivity.js` projects
background check results into diagnostic icons. `playground.js` wires the
original operator controller and clients in `vendor/atmungsraum/` to the in-page Quest, recording, and Drive
backends. The transport exercises the clients' signed and encrypted message
validation. Discovery returns synthetic metadata. Recordings use a fixed demo
identity and a dedicated browser cache. Requests stay on the page's origin.
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

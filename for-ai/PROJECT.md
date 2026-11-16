# Project contract

## Purpose

Provide a stand-alone smartphone UI playground for Atmungsraum, with a stable
synthetic ECG feed and reproducible operator screens for design refinement.

## Active checklist

- [x] Pin the existing German UI and keep the HTML IDs, CSS and shared renderers.
- [x] Implement mock pairing, control ownership, participant form, Polar and ECG,
  breathing setup, session controls, kiosk status and synthetic downloads.
- [x] Reuse the original seeded NeuroKit2 fixture with a hash check.
- [x] Verify the complete browser flow and the responsive layout matrix.
- [ ] Verify the exact GitHub Pages deployment.

## Ownership

Static HTML/CSS and JavaScript at the repository root. `app.js` owns
Pretext measurement. `playground.js` owns in-page mock UI state.
`simulation.js` maps the fixture to display inputs and synthetic CSV.
There is no native, browser-to-device or cloud transport. Keep fixture inputs
ephemeral and synthetic. See [README](../README.md) for transferring design
changes to the original app.

Upstream visuals are pinned to `3f8d7c8befa3c13d1e8f574e82082468ba5128f7`.
The ECG binary and generator come from the original Atmungsraum work at
`1a8057234a69bbfec40ca937983f036b7d8df5e0`. The manifest records the seed,
versions and checksum. No ECG data was acquired from a person.

Local verification passed all three Node tests and the Chrome flow, including
32-second calibration, viewport reflow, 200% text and text spacing. The
first Pages deployment will be checked at the exact pushed commit.

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
- [x] Verify the exact GitHub Pages deployment.

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

The `ui-playground-baseline` tag names the first release at `4283741`.
[Pages run 43866774013](https://github.com/GeorgeFejer91/atmungsraum-ui/actions/runs/43866774013)
deployed that exact commit from `main`. Fifteen public files matched Git.
All three Node tests passed locally. The Chrome flow and seven-screen layout
matrix passed locally and on Pages at 320px, 200% text, narrow landscape,
custom text spacing, and desktop size. Checks used synthetic state and files.

The first playground milestone is complete. For the next design refinement,
use the baseline tag and port only the intended presentation changes.
Physical-phone installation and production hardware acceptance are separate.

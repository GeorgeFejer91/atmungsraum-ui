# Verification

- `pnpm test` checks the fixture checksum, replay/wrap, waveform gaps,
  session timing and synthetic CSV.
- `python tools/check-ui.py` exercises the browser flow and its responsive
  smoke checks. Use `--url` for the published site.
- `for-ai/scripts/check-context.ps1 -RequireRemote` checks the control plane
  against the configured remote. Check the exact Pages run for the pushed SHA
  and compare the public entry, display scripts, manifest and fixture bytes.

## Smartphone GUI release gate

Before every feature push, pass the browser flow and this gate against the
exact candidate. Run `python -B for-ai/scripts/check-gui.py` while developing
or add `--ref HEAD` to audit the committed tree. Enable the tracked local hook
in each checkout with `git config --local core.hooksPath for-ai/hooks`. The
hook runs the strict browser gate for product changes on branch pushes. A gate
failure exits nonzero and stops the push.

Check the [smartphone GUI design rules](./PROJECT.md#smartphone-gui-design-rules)
with these requirements.

- Exercise every app screen and dialog, including expanded sections, forms
  with the keyboard up, validation and error states, and the longest supported
  strings and list states. Cover 320 × 640 and 390 × 844 CSS pixels in portrait,
  844 × 390 in landscape, and 1440 × 900 for desktop regression. Include 200%
  text, user text-spacing overrides, and both sides of relevant layout
  breakpoints. Check the claimed phone browsers.
- Verify that input steps have no generic page arrows. Exercise successful
  background checks and independent Bluetooth, bridge, APK, and Polar
  failures. Check red-icon popup activation and focus restoration.
- The strict browser gate checks document and nested overflow in both axes,
  viewport and control bounds, measured text fit, and stretch geometry. Each
  screen and dialog needs a direct header or heading, a flexible `.screen-body`,
  and a direct action footer. The body must grow with added width and height
  and distribute added height between multiple ordered groups.
- Confirm painted text, clipping, unobstructed controls, and freedom from
  scrolling during navigation, touch gestures, and keyboard focus changes.
  Use a phone for safe areas and keyboard behavior when the harness cannot
  reproduce them.
- Review narrow, short, and expanded layouts for header and action anchors,
  stable group and focus order, spacing that adapts to both axes, visible
  focus, and usable touch targets. Verify locked Pretext measurement with the
  actual typography after fonts load. Compare with the painted DOM, including
  text-spacing overrides and any layout used when the preferred text cannot fit.
- Check shared control edges and equal cell sizes within peer rows, including
  when a label wraps. Verify that nested form groups fill the available body
  and that their spacing grows when the body gains usable height.
- Record the candidate SHA, commands, browser or device, viewport and UI
  states, and results. Record where emulation or a physical device supplied
  the evidence. Any overflow, hidden field, clipped text, overlap,
  inaccessible action, or missing required evidence blocks the feature push.

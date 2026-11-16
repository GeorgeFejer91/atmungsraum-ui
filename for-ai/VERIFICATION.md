# Verification

- `pnpm test` checks the fixture checksum, replay/wrap, waveform gaps,
  session timing and synthetic CSV.
- `python tools/check-ui.py` exercises the complete browser flow and checks
  320px reflow, 200% text, CSS text spacing, portrait, landscape and wide layout.
  Use `--url` for the published site.
- `for-ai/scripts/check-context.ps1 -RequireRemote` checks the control plane
  against the configured remote. Check the exact Pages run for the pushed SHA
  and compare the public entry, display scripts, manifest and fixture bytes.

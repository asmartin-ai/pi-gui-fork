#!/bin/sh
set -eu
cd "$(dirname "$0")/../../../.."
mkdir -p .artifacts/verify-pi-gui
PI_GUI_PROOF_DIR=$(mktemp -d "$PWD/.artifacts/verify-pi-gui/run-XXXXXX")
export PI_GUI_PROOF_DIR
printf 'Evidence: %s\n' "$PI_GUI_PROOF_DIR"
if pnpm --filter @pi-gui/desktop run build >"$PI_GUI_PROOF_DIR/build.log" 2>&1; then
  :
else
  cat "$PI_GUI_PROOF_DIR/build.log"
  exit 1
fi
set +e
PI_APP_TEST_MODE=background pnpm exec playwright test -c .agents/skills/verify-pi-gui/scripts/playwright.config.ts --output "$PI_GUI_PROOF_DIR/playwright" --reporter=line >"$PI_GUI_PROOF_DIR/run.log" 2>&1
result=$?
set -e
cat "$PI_GUI_PROOF_DIR/run.log"
printf '%s\n' "$result" >"$PI_GUI_PROOF_DIR/exit-code.txt"
# The spec closes only its own Electron applications, even on assertion failure.
# Keep profile/workspace too: repo policy forbids deleting temp artifacts without approval.
if [ "$result" -eq 0 ]; then
  test -s "$PI_GUI_PROOF_DIR/result.json"
  test -s "$PI_GUI_PROOF_DIR/cleanup.json"
  test -s "$PI_GUI_PROOF_DIR/restart.png"
  test -s "$PI_GUI_PROOF_DIR/restart.zip"
fi
printf 'Retained evidence: %s\n' "$PI_GUI_PROOF_DIR"
exit "$result"

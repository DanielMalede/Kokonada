#!/bin/bash
# The Xcode "Bundle React Native code and images" phase (MB-093; QA-077 clause A1; CMP-141).
#
# The phase runs this through React Native's with-environment.sh, so ios/.xcode.env and
# ios/.xcode.env.local are already sourced, and this sees exactly the environment that
# react-native-xcode.sh would see. react-native-xcode.sh bundles $ENTRY_FILE whenever it is set, else
# index.ios.js if one exists, else index.js. Either of the first two would put another entry, such as
# the Design Lab's index.lab.js, into an archive that can go to TestFlight. So this refuses both, the
# other inputs that can redirect or drop the bundle (below), and a PROJECT_ROOT other than this app's,
# and only then hands over. scripts/ios/__tests__/bundlePhase.test.ts pins it and the phase.
set -e

refuse() {
  echo "error: $1" >&2
  exit 1
}

if [ "$#" -ne 0 ]; then
  refuse "the bundle phase takes no arguments; react-native-xcode.sh would read one as the entry file (MB-093)."
fi

if [ -n "${ENTRY_FILE:-}" ] && [ "$ENTRY_FILE" != "index.js" ]; then
  refuse "ENTRY_FILE is \"$ENTRY_FILE\". The iOS bundle phase builds index.js only (MB-093): unset ENTRY_FILE in the environment, in ios/.xcode.env and in ios/.xcode.env.local."
fi

# Every other react-native-xcode.sh variable that can change what is bundled, or what bundles it,
# comes from the same places as ENTRY_FILE. This phase takes React Native's defaults only.
# Deliberately not refused: NODE_BINARY (ios/.xcode.env sets it) and HERMES_CLI_PATH (React Native's
# pods set it). Those, and any other input, are left to the scan of the exact IPA (QA-077 D9), which
# is the control for the whole class; this list is not exhaustive.
for v in EXTRA_PACKAGER_ARGS CLI_PATH BUNDLE_COMMAND BUNDLE_CONFIG CONFIG_JSON CONFIG_CMD NODE_ARGS BUNDLE_NAME; do
  if [ -n "${!v:-}" ]; then
    refuse "$v is set (\"${!v}\"). It can change what the iOS bundle phase bundles; this phase takes React Native's defaults only (MB-093). Unset it in the environment, in ios/.xcode.env and in ios/.xcode.env.local."
  fi
done
case "${CONFIGURATION:-}" in
  *Debug*) ;;
  *) if [ -n "${SKIP_BUNDLING:-}" ]; then refuse "SKIP_BUNDLING is set for a ${CONFIGURATION:-non-Debug} build: an archive must carry the bundle built from index.js (MB-093)."; fi ;;
esac

# The folder react-native-xcode.sh bundles from: PROJECT_ROOT, else one level above the Xcode project.
if [ -z "${PROJECT_ROOT:-}" ] && [ -z "${PROJECT_DIR:-}" ]; then
  refuse "PROJECT_DIR is not set: this runs only as the Xcode bundle phase (MB-093)."
fi
ROOT="${PROJECT_ROOT:-$PROJECT_DIR/..}"
if [ -e "$ROOT/index.ios.js" ]; then
  refuse "$ROOT/index.ios.js exists. react-native-xcode.sh would bundle it instead of index.js; the iOS bundle phase builds index.js only (MB-093). Remove it."
fi
if [ -n "${PROJECT_ROOT:-}" ] && [ "$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P)" != "$(cd "${PROJECT_DIR:-$PROJECT_ROOT}/.." && pwd -P)" ]; then
  refuse "PROJECT_ROOT is \"$PROJECT_ROOT\", not this app's root: the iOS bundle phase bundles this app's index.js only (MB-093)."
fi

REACT_NATIVE_XCODE="${REACT_NATIVE_PATH:-}/scripts/react-native-xcode.sh"
if [ ! -f "$REACT_NATIVE_XCODE" ]; then
  refuse "no react-native-xcode.sh at $REACT_NATIVE_XCODE (REACT_NATIVE_PATH=${REACT_NATIVE_PATH:-unset})."
fi

exec "$REACT_NATIVE_XCODE"

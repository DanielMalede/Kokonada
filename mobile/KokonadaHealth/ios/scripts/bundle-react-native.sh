#!/bin/bash
# The Xcode "Bundle React Native code and images" phase (MB-093; QA-077 clause A1; CMP-141).
#
# The phase runs this through React Native's with-environment.sh, so ios/.xcode.env and
# ios/.xcode.env.local are already sourced, and this sees exactly the environment that
# react-native-xcode.sh would see. react-native-xcode.sh bundles $ENTRY_FILE whenever it is set, else
# index.ios.js if one exists, else index.js. Either of the first two would put another entry, such as
# the Design Lab's index.lab.js, into an archive that can go to TestFlight. So this refuses both, and
# only then hands over. scripts/ios/__tests__/bundlePhase.test.ts pins it and the phase.
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

# The folder react-native-xcode.sh bundles from: PROJECT_ROOT, else one level above the Xcode project.
if [ -z "${PROJECT_ROOT:-}" ] && [ -z "${PROJECT_DIR:-}" ]; then
  refuse "PROJECT_DIR is not set: this runs only as the Xcode bundle phase (MB-093)."
fi
ROOT="${PROJECT_ROOT:-$PROJECT_DIR/..}"
if [ -e "$ROOT/index.ios.js" ]; then
  refuse "$ROOT/index.ios.js exists. react-native-xcode.sh would bundle it instead of index.js; the iOS bundle phase builds index.js only (MB-093). Remove it."
fi

REACT_NATIVE_XCODE="${REACT_NATIVE_PATH:-}/scripts/react-native-xcode.sh"
if [ ! -f "$REACT_NATIVE_XCODE" ]; then
  refuse "no react-native-xcode.sh at $REACT_NATIVE_XCODE (REACT_NATIVE_PATH=${REACT_NATIVE_PATH:-unset})."
fi

exec "$REACT_NATIVE_XCODE"

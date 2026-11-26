/**
 * @format
 */

// Polyfill global.crypto.getRandomValues BEFORE anything else — the encrypted MMKV
// backend (src/platform/mmkvBackend.ts) needs a CSPRNG to mint its 256-bit key at
// first launch. Must be the first import so the global is set up before app bootstrap.
import 'react-native-get-random-values';
import { AppRegistry, DevSettings } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// The debug app only: a dev-menu item swaps the root for the field preview. Metro folds this branch away
// with --dev false, so no release bundle holds it (scripts/jest/__tests__/devPreviewExcluded.test.ts).
let Root = App;
if (__DEV__) {
  Root = require('./src/design/v2/preview/devRoot.tsx').withFieldPreview(App, DevSettings);
}

AppRegistry.registerComponent(appName, () => Root);

/**
 * @format
 */

// Polyfill global.crypto.getRandomValues BEFORE anything else — the encrypted MMKV
// backend (src/platform/mmkvBackend.ts) needs a CSPRNG to mint its 256-bit key at
// first launch. Must be the first import so the global is set up before app bootstrap.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

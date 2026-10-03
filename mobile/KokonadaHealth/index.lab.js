/**
 * The Design Lab entry (MB-084). It is bundled ONLY into the `lab` Android build type, by the lab
 * scripts (scripts/lab), and is never reached from index.js: the release entry's import closure,
 * its Metro bundle and every upload artifact are checked for it (npm run lab:excluded).
 *
 * LabRoot (MB-085) reads the launch arguments, draws the named scene, and sends READY lines that
 * carry the sentinel, so the lab bundle always holds it.
 *
 * @format
 */

import { AppRegistry } from 'react-native';
import { LabRoot } from './src/design/lab/LabRoot';

AppRegistry.registerComponent('KokonadaLab', () => LabRoot);

/**
 * The Design Lab entry (MB-084). It is bundled ONLY into the `lab` Android build type, by the lab
 * scripts (scripts/lab), and is never reached from index.js: the release entry's import closure,
 * its Metro bundle and every upload artifact are checked for it (npm run lab:excluded).
 *
 * @format
 */

import { AppRegistry } from 'react-native';
import { LAB_SENTINEL } from './src/design/lab/sentinel';

// MB-085 replaces this placeholder with the lab runtime. Until then the lab renders nothing, and
// carries the sentinel so the exclusion check's positive control can see the lab bundle.
function DesignLab() {
  return null;
}
DesignLab.sentinel = LAB_SENTINEL;

AppRegistry.registerComponent('KokonadaLab', () => DesignLab);

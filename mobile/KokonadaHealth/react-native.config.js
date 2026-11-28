const path = require('path');

// Local-library autolinking: treat modules/spotify-remote as an installed native
// dependency without publishing it to npm or copying it into node_modules.
module.exports = {
  // Fonts to bundle + link (via `npx react-native-asset`). None is linked: the app's faces are
  // the platform System face, and the v2 faces in assets/fonts (Heebo, Bellefair) wait for their
  // production route (F6; CMP-117's licences page). Each font there carries its family's SIL OFL
  // text beside it, OFL-<Family>.txt (src/design/__tests__/fontLicence.test.ts); see
  // assets/fonts/README.md.
  assets: ['./assets/fonts'],
  dependencies: {
    '@kokonada/spotify-remote': {
      root: path.join(__dirname, 'modules/spotify-remote'),
    },
  },
};

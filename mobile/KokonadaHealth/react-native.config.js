const path = require('path');

// Local-library autolinking: treat modules/spotify-remote as an installed native
// dependency without publishing it to npm or copying it into node_modules.
module.exports = {
  dependencies: {
    '@kokonada/spotify-remote': {
      root: path.join(__dirname, 'modules/spotify-remote'),
    },
  },
};

// backend/tests/trackCatalog.model.test.js
const TrackCatalog = require('../app/models/TrackCatalog');

describe('TrackCatalog model', () => {
  it('has the metadata paths keyed by recordingKey', () => {
    const paths = TrackCatalog.schema.paths;
    expect(paths.recordingKey.options.unique).toBe(true);
    expect(paths.recordingKey.isRequired).toBe(true);
    expect(paths.canonicalKey).toBeDefined();
    expect(paths.uri).toBeDefined();
    expect(paths.title).toBeDefined();
    expect(paths.artist).toBeDefined();
    expect(paths.genres.instance).toBe('Array');
  });

  it('ZERO-KNOWLEDGE: stores no user identifiers or linkage', () => {
    const paths = Object.keys(TrackCatalog.schema.paths);
    for (const forbidden of ['userId', 'profileId', 'user', 'listener', 'ownerId', 'userIds']) {
      expect(paths).not.toContain(forbidden);
    }
  });
});

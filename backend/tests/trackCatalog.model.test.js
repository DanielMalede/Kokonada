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

  it('carries a NON-USER provenance `source` enum (library|global), default library, indexed — ADR-0008 safe', () => {
    const src = TrackCatalog.schema.paths.source;
    expect(src).toBeDefined();
    expect(src.instance).toBe('String');
    expect(src.options.default).toBe('library');
    expect(src.enumValues).toEqual(['library', 'global']);
    expect(src.options.index).toBe(true);
  });

  it('ZERO-KNOWLEDGE: every schema path is an allowlisted metadata field (no user linkage possible)', () => {
    const META = new Set(['_id', '__v', 'updatedAt']);
    const ALLOWED = new Set(['recordingKey', 'canonicalKey', 'uri', 'title', 'artist', 'genres', 'source']);
    for (const path of Object.keys(TrackCatalog.schema.paths)) {
      if (META.has(path)) continue;
      expect(ALLOWED.has(path)).toBe(true); // any non-allowlisted path (incl. nested user linkage) fails here
    }
  });
});

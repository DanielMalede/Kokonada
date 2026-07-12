// backend/tests/discoveryMetrics.test.js
const vectorIndex = require('../app/services/vector/vectorIndex');
const svc = require('../app/services/discovery/discoveryVectorService');

describe('discovery metrics', () => {
  afterEach(() => vectorIndex.use(null));
  it('logs a [discovery] metric line per find', async () => {
    vectorIndex.use({ queryNear: async () => [] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await svc.find({ targetFeatures: { bpm: 90 }, seedGenres: [], excludeCanonicalKeys: new Set(), budgetMs: 200 });
    expect(spy.mock.calls.flat().some(l => String(l).includes('[discovery]'))).toBe(true);
    spy.mockRestore();
  });
});

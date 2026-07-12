// backend/tests/mongoAtlasVectorAdapter.test.js
const { rawCosineFromAtlasScore } = require('../app/services/vector/mongoAtlasVectorAdapter');

describe('rawCosineFromAtlasScore', () => {
  it('inverts Atlas cosine normalization (1+cos)/2 back to raw cosine', () => {
    expect(rawCosineFromAtlasScore(1)).toBe(1);
    expect(rawCosineFromAtlasScore(0.5)).toBe(0);
    expect(rawCosineFromAtlasScore(0.75)).toBe(0.5);
  });
});

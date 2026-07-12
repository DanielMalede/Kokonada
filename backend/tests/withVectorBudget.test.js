// backend/tests/withVectorBudget.test.js
const { withVectorBudget } = require('../app/services/discovery/withVectorBudget');

const slow = (ms, val) => new Promise(r => setTimeout(() => r(val), ms));

describe('withVectorBudget', () => {
  it('returns the value when it settles in time', async () => {
    expect(await withVectorBudget(slow(5, ['a']), 100, [])).toEqual(['a']);
  });
  it('returns the fallback when the promise is too slow', async () => {
    expect(await withVectorBudget(slow(100, ['a']), 10, [])).toEqual([]);
  });
  it('returns the fallback when the promise rejects', async () => {
    expect(await withVectorBudget(Promise.reject(new Error('boom')), 100, [])).toEqual([]);
  });
});

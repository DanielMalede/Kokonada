'use strict';

// A stateful fake clock with real behaviour: `sleep(ms)` moves time forward by ms and records the
// wait, so every backoff and every spacing wait the code under test takes is visible and costs no
// real time. Time never runs backwards.
function fakeClock(startIso) {
  let t = Date.parse(startIso);
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += Math.max(0, ms);
    },
    advance(ms) {
      t += ms;
    },
    set(ms) {
      if (ms < t) throw new Error('the fake clock never runs backwards');
      t = ms;
    },
    sleeps,
  };
}

module.exports = { fakeClock };

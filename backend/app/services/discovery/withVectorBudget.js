// backend/app/services/discovery/withVectorBudget.js
'use strict';

// Bound a vector query by a wall-clock budget that YIELDS to delivery: on timeout OR
// rejection, resolve the fallback (never throw, never block the generation wall-clock).
function withVectorBudget(promise, ms, fallback) {
  let timer;
  const budget = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    budget,
  ]).finally(() => clearTimeout(timer));
}

module.exports = { withVectorBudget };

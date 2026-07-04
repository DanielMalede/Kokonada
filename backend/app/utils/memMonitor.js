'use strict';

const v8 = require('v8');
const os = require('os');

// TEMP DIAGNOSTIC (remove once the generation OOM is root-caused). Logs the memory
// ceiling once, then heapUsed/rss every few seconds. Correlated with the existing
// generation ("[generate] ...") and profile-build progress logs, the timeline
// pinpoints WHICH operation balloons the heap toward the ~489MB crash — a steady
// climb that never releases = a leak; a spike during one stage = that stage's cost;
// a legitimately-large-but-bounded plateau near the limit = too little container RAM.
let timer = null;

function startMemMonitor(intervalMs = 2500) {
  if (timer) return;
  const mb = (b) => Math.round(b / 1048576);
  const heapLimit = mb(v8.getHeapStatistics().heap_size_limit);
  console.warn(
    `[mem] MONITOR START — v8.heap_size_limit=${heapLimit}MB os.totalmem=${mb(os.totalmem())}MB os.freemem=${mb(os.freemem())}MB`,
  );
  timer = setInterval(() => {
    const m = process.memoryUsage();
    console.warn(
      `[mem] heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB rss=${mb(m.rss)}MB external=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB`,
    );
  }, intervalMs);
  if (timer.unref) timer.unref(); // never keep the process alive for the monitor alone
}

// Synchronous heap marker — prints heapUsed at a labelled point so the LAST marker
// before the OOM pinpoints the exact stage/await where the ~442MB allocation happens.
// (console.warn is sync + flushes, so it survives right up to the crash.) TEMP.
function heapMark(label) {
  console.warn(`[mem-mark] ${label} heapUsed=${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`);
}

module.exports = { startMemMonitor, heapMark };

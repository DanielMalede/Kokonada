'use strict';

process.env.NODE_ENV = 'test';

const { moodProximity, exposurePenalty } = require('../app/services/ledger/exposureScore');
const { moodCoords } = require('../app/services/moodDescriptors');

const HOUR = 3_600_000;
const NOW = Date.parse('2026-07-02T12:00:00Z');

describe('moodProximity', () => {
  it('is 1 for identical mood contexts', () => {
    expect(moodProximity(moodCoords('focus'), moodCoords('focus'), 0.4)).toBe(1);
  });

  it('decays with distance in (energy, valence) space', () => {
    const calmVsUnwind  = moodProximity(moodCoords('calm'), moodCoords('unwind'), 0.4);
    const calmVsIntense = moodProximity(moodCoords('calm'), moodCoords('intense'), 0.4);
    expect(calmVsUnwind).toBeLessThan(1);
    expect(calmVsIntense).toBeLessThan(calmVsUnwind); // intense is far from calm; unwind is adjacent
  });
});

describe('exposurePenalty', () => {
  const serve = (moodKey, hoursAgo) => ({ moodKey, servedAt: new Date(NOW - hoursAgo * HOUR) });

  it('is 0 with no serve history', () => {
    expect(exposurePenalty({ serves: [], targetMoodKey: 'focus', now: NOW })).toBe(0);
  });

  it('decays exponentially with age (tau)', () => {
    const fresh = exposurePenalty({ serves: [serve('focus', 1)],  targetMoodKey: 'focus', now: NOW, tauHours: 96 });
    const stale = exposurePenalty({ serves: [serve('focus', 96)], targetMoodKey: 'focus', now: NOW, tauHours: 96 });
    expect(fresh).toBeGreaterThan(stale);
    expect(stale / fresh).toBeCloseTo(Math.exp(-(96 - 1) / 96), 5);
  });

  it('a recent same-mood serve outweighs an old distant-mood serve', () => {
    const sameRecent  = exposurePenalty({ serves: [serve('focus', 2)],    targetMoodKey: 'focus', now: NOW });
    const distantOld  = exposurePenalty({ serves: [serve('intense', 90)], targetMoodKey: 'focus', now: NOW });
    expect(sameRecent).toBeGreaterThan(distantOld);
  });

  it('accumulates across multiple serves', () => {
    const once  = exposurePenalty({ serves: [serve('focus', 5)], targetMoodKey: 'focus', now: NOW });
    const twice = exposurePenalty({ serves: [serve('focus', 5), serve('uplift', 10)], targetMoodKey: 'focus', now: NOW });
    expect(twice).toBeGreaterThan(once);
  });

  it('synthetic bio moodKeys participate in proximity like any mood', () => {
    const bioVsIntense = exposurePenalty({ serves: [serve('bio:peak:running', 2)], targetMoodKey: 'intense', now: NOW });
    const bioVsCalm    = exposurePenalty({ serves: [serve('bio:peak:running', 2)], targetMoodKey: 'calm', now: NOW });
    expect(bioVsIntense).toBeGreaterThan(bioVsCalm); // peak-HR context is nearer intense than calm
  });
});

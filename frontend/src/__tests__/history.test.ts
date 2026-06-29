import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSessions, saveSession, deleteSession, deleteSessions, type Session,
} from '../lib/history';

function makeSession(id: string, createdAt: number): Session {
  return {
    id, moodKey: 'focus', moodLabel: 'Focus', textPrompt: '', mode: 'live',
    heartRate: null, activity: null, createdAt,
    tracks: [{ id: `tr-${id}`, title: 't', artist: 'a', uri: `spotify:track:${id}` }],
  };
}

describe('history delete', () => {
  beforeEach(() => localStorage.clear());

  it('deleteSession removes only the targeted session', () => {
    saveSession(makeSession('a', 3));
    saveSession(makeSession('b', 2));
    saveSession(makeSession('c', 1));

    deleteSession('b');

    expect(getSessions().map((s) => s.id)).toEqual(['c', 'a']);
  });

  it('deleteSession is a no-op for an unknown id', () => {
    saveSession(makeSession('a', 1));
    deleteSession('nope');
    expect(getSessions().map((s) => s.id)).toEqual(['a']);
  });

  it('deleteSessions removes every id in the set in one write', () => {
    saveSession(makeSession('a', 4));
    saveSession(makeSession('b', 3));
    saveSession(makeSession('c', 2));
    saveSession(makeSession('d', 1));

    deleteSessions(['b', 'd']);

    expect(getSessions().map((s) => s.id)).toEqual(['c', 'a']);
  });

  it('deleteSessions with an empty list leaves history untouched', () => {
    saveSession(makeSession('a', 1));
    deleteSessions([]);
    expect(getSessions().map((s) => s.id)).toEqual(['a']);
  });
});

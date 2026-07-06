import { createGenerationStatusStore } from '../generationStatusStore';

describe('generationStatusStore', () => {
  it('begin flips generating on; settle flips it off', () => {
    const s = createGenerationStatusStore();
    expect(s.getState().generating).toBe(false);
    s.getState().begin();
    expect(s.getState().generating).toBe(true);
    s.getState().settle();
    expect(s.getState().generating).toBe(false);
  });

  it('auto-settles after the timeout so a lost response never spins the loader forever', () => {
    jest.useFakeTimers();
    const s = createGenerationStatusStore(1000);
    s.getState().begin();
    expect(s.getState().generating).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(s.getState().generating).toBe(false);
    jest.useRealTimers();
  });

  it('settle cancels the pending auto-settle so it cannot flip a fresh generation off late', () => {
    jest.useFakeTimers();
    const s = createGenerationStatusStore(1000);
    s.getState().begin();
    s.getState().settle(); // response arrived quickly
    jest.advanceTimersByTime(1000); // the old timer must be dead
    expect(s.getState().generating).toBe(false);
    s.getState().begin(); // a NEW request still arms its own timer
    expect(s.getState().generating).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(s.getState().generating).toBe(false);
    jest.useRealTimers();
  });
});

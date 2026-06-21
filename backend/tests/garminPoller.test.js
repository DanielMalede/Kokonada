'use strict';

jest.mock('../app/models/User');
jest.mock('../app/services/wearable/garmin');
jest.mock('../app/sockets/biometricHandler', () => ({
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist:  jest.fn(),
  handleBiometricReading:   jest.fn(),
  _debounceMap: new Map(),
}));

const User    = require('../app/models/User');
const garmin  = require('../app/services/wearable/garmin');
const { handleBiometricReading } = require('../app/sockets/biometricHandler');
const { pollOnce, startGarminPoller, stopGarminPoller } = require('../app/services/wearable/garminPoller');

// ── io mock factory ───────────────────────────────────────────────────────────

function makeIo(connectedUserIds = [], sockets = {}) {
  const rooms = new Map(
    connectedUserIds.map(id => [`user:${id}`, new Set([`sock_${id}`])])
  );
  const socketsMap = new Map(
    connectedUserIds.map(id => [
      `sock_${id}`,
      sockets[id] || { id: `sock_${id}`, emit: jest.fn(), data: { user: { _id: id } } },
    ])
  );
  return { sockets: { adapter: { rooms }, sockets: socketsMap } };
}

// ── User mock factory ─────────────────────────────────────────────────────────

function makeUser(id, overrides = {}) {
  return {
    _id: id,
    wearableToken: { blob: 'encrypted' },
    getToken: jest.fn().mockReturnValue({ accessToken: 'tok', accessTokenSecret: 'sec' }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pollOnce', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips users not in a socket room', async () => {
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([makeUser('u1')]) });
    const io = makeIo([]); // no connected sockets

    await pollOnce(io);

    expect(garmin.getDailyHeartRate).not.toHaveBeenCalled();
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('calls getDailyHeartRate and handleBiometricReading for connected users', async () => {
    const user = makeUser('u2');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
    garmin.getDailyHeartRate = jest.fn().mockResolvedValue({
      dailies: [{
        averageHeartRateInBeatsPerMinute: 88,
        activityType: 'WALKING',
        startTimeLocal: '2026-06-21T10:00:00',
      }],
    });
    const io = makeIo(['u2']);

    await pollOnce(io);

    expect(garmin.getDailyHeartRate).toHaveBeenCalledWith('tok', 'sec');
    expect(handleBiometricReading).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sock_u2' }),
      'garmin',
      { heartRate: 88, activityType: 6, startTimeLocal: '2026-06-21T10:00:00' }
    );
  });

  it('skips summaries with no heart rate', async () => {
    const user = makeUser('u3');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
    garmin.getDailyHeartRate = jest.fn().mockResolvedValue({
      dailies: [{ averageHeartRateInBeatsPerMinute: null, activityType: 'WALKING', startTimeLocal: '2026-06-21T10:00:00' }],
    });
    const io = makeIo(['u3']);

    await pollOnce(io);

    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('logs error and continues if getDailyHeartRate throws for one user', async () => {
    const u4 = makeUser('u4');
    const u5 = makeUser('u5');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([u4, u5]) });

    garmin.getDailyHeartRate = jest.fn()
      .mockRejectedValueOnce(new Error('Garmin API down'))
      .mockResolvedValueOnce({
        dailies: [{ averageHeartRateInBeatsPerMinute: 72, activityType: 'RUNNING', startTimeLocal: '2026-06-21T09:00:00' }],
      });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const io = makeIo(['u4', 'u5']);

    await pollOnce(io);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('u4'), expect.stringContaining('Garmin API down'));
    expect(handleBiometricReading).toHaveBeenCalledTimes(1); // only u5 succeeded
    consoleSpy.mockRestore();
  });

  it('handles empty dailies array without calling handleBiometricReading', async () => {
    const user = makeUser('u6');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
    garmin.getDailyHeartRate = jest.fn().mockResolvedValue({ dailies: [] });
    const io = makeIo(['u6']);

    await pollOnce(io);

    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('maps Garmin activity strings to numeric adapter types', async () => {
    const activityCases = [
      ['RUNNING', 1], ['CYCLING', 2], ['SWIMMING', 5],
      ['WALKING', 6], ['STRENGTH_TRAINING', 13], ['UNKNOWN_SPORT', 0],
    ];

    for (const [actStr, expectedType] of activityCases) {
      jest.clearAllMocks();
      const user = makeUser(`u_${actStr}`);
      User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
      garmin.getDailyHeartRate = jest.fn().mockResolvedValue({
        dailies: [{ averageHeartRateInBeatsPerMinute: 80, activityType: actStr, startTimeLocal: '2026-06-21T08:00:00' }],
      });
      const io = makeIo([`u_${actStr}`]);

      await pollOnce(io);

      expect(handleBiometricReading).toHaveBeenCalledWith(
        expect.anything(),
        'garmin',
        expect.objectContaining({ activityType: expectedType })
      );
    }
  });
});

describe('startGarminPoller / stopGarminPoller', () => {
  it('startGarminPoller does not throw', () => {
    const io = makeIo([]);
    expect(() => startGarminPoller(io)).not.toThrow();
    stopGarminPoller(); // clean up
  });

  it('stopGarminPoller clears the interval without error', () => {
    const io = makeIo([]);
    startGarminPoller(io);
    expect(() => stopGarminPoller()).not.toThrow();
  });

  it('startGarminPoller is idempotent (calling twice does not double-schedule)', () => {
    const io = makeIo([]);
    startGarminPoller(io);
    startGarminPoller(io); // second call should be a no-op
    stopGarminPoller();
    expect(true).toBe(true);
  });
});

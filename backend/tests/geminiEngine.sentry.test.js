'use strict';

// What the generation path hands to Sentry when Groq fails. A real AxiosError carries the
// request it came from: `config.headers.Authorization` (the Bearer key), `config.data` (the JSON
// body, i.e. the prompt) and `request._header` (the raw request head, key included). Passing that
// object to captureException ships all of it to a third party. Only a sanitized error may leave.

process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = 'test-llm-key';
delete process.env.GROQ_API_KEY;
delete process.env.LLM_MODEL;

jest.mock('axios');
jest.mock('../app/config/sentry', () => ({ captureException: jest.fn() }));

const util = require('util');
const axios = require('axios');
const { AxiosError } = jest.requireActual('axios');
const { captureException } = require('../app/config/sentry');
const { buildEmotionPlaylist } = require('../app/services/geminiEngine');

const MUSIC_PROFILE = {
  topGenres: ['electronic', 'indie'], tempoBaseline: 120,
  energy: 0.7, valence: 0.6, acousticness: 0.2, restingHeartRate: 65,
};
const emotionTaps = [{ x: 0.5, y: 0.5 }];
const SEED = 'CANARY-SEED-sentry'; // lands in the prompt as the variation token

// Reject exactly the way axios does, from the request our code actually sent.
function rejectLikeAxios(status, error) {
  axios.post.mockImplementation((url, body, cfg) => {
    const config = { url, method: 'post', data: JSON.stringify(body), headers: { ...cfg.headers }, timeout: cfg.timeout };
    const request = { _header: `POST ${url} HTTP/1.1\r\nAuthorization: ${cfg.headers.Authorization}\r\n\r\n` };
    const response = { status, statusText: 'x', headers: {}, config, data: { error } };
    return Promise.reject(new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, request, response));
  });
}

const everythingCaptured = () => util.inspect(captureException.mock.calls, { depth: 20, showHidden: true, maxStringLength: Infinity });

beforeEach(() => jest.clearAllMocks());

describe('generation failures reach Sentry sanitized', () => {
  it('captures the wrapper message, the status and the model — no Authorization header, no key, no prompt', async () => {
    rejectLikeAxios(503, { message: 'Service unavailable', code: 'service_unavailable' });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn(), seed: SEED }),
    ).rejects.toThrow('LLM request failed');

    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, context] = captureException.mock.calls[0];
    expect(err.message).toBe('LLM request failed (openai/gpt-oss-20b): Service unavailable');
    expect(context).toMatchObject({ model: 'openai/gpt-oss-20b', status: 503 });
    expect(err).not.toHaveProperty('config');
    expect(err).not.toHaveProperty('request');
    expect(err).not.toHaveProperty('response');

    const prompt = axios.post.mock.calls[0][1].messages[0].content;
    const captured = everythingCaptured();
    for (const secret of ['test-llm-key', 'Authorization', 'Bearer', SEED, 'expert musicologist', prompt]) {
      expect(captured).not.toContain(secret);
    }
  });

  it('a timeout (no HTTP response) is captured sanitized too', async () => {
    axios.post.mockImplementation((url, body, cfg) => Promise.reject(new AxiosError(
      'timeout of 5000ms exceeded', 'ECONNABORTED',
      { url, data: JSON.stringify(body), headers: { ...cfg.headers } },
      { _header: `POST ${url}\r\nAuthorization: ${cfg.headers.Authorization}` },
    )));

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn(), seed: `${SEED}-timeout` }),
    ).rejects.toThrow('timeout');

    const captured = everythingCaptured();
    expect(captured).not.toContain('test-llm-key');
    expect(captured).not.toContain('Authorization');
    expect(captured).not.toContain(`${SEED}-timeout`);
  });
});

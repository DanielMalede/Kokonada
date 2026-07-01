'use strict';

const { Server } = require('socket.io');
const cookie = require('cookie');
const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const User = require('../models/User');
const { registerBiometricHandler } = require('./biometricHandler');
const { captureException } = require('../config/sentry');

// Live Socket.IO server instance, captured on creation so non-socket code
// (e.g. the watch HR ingest controller) can look up a user's browser socket.
let _io = null;

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token;

      if (!token) {
        const rawCookie = socket.handshake.headers.cookie;
        if (rawCookie) {
          const parsed = cookie.parse(rawCookie);
          token = parsed[COOKIE_NAME];
        }
      }

      if (!token) return next(new Error('unauthorized'));

      const payload = verifyToken(token);
      const user = await User.findById(payload.userId).select(
        '-spotifyToken -youtubeMusicToken -wearableToken'
      );

      if (!user || user.deletedAt) return next(new Error('unauthorized'));

      socket.data.user = user;
      next();
    } catch (err) {
      // Bad/expired tokens are routine and expected — don't report those. Anything
      // else caught here (e.g. a DB error while loading the user) is a real fault that
      // was previously swallowed silently; surface it.
      const expected = err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError');
      if (!expected) captureException(err, { scope: 'socket.auth' });
      next(new Error('unauthorized'));
    }
  });

  // Low-level engine failures (failed WebSocket upgrades, transport/handshake errors,
  // reconnect failures) never reach the middleware above — capture them here so a client
  // that can't stay connected is visible instead of silently dark.
  io.engine.on('connection_error', (err) => {
    captureException(err, { scope: 'socket.engine', code: err?.code, message: err?.message });
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user._id}`);
    // Per-socket runtime errors (handler throws, transport drops mid-stream).
    socket.on('error', (err) => {
      captureException(err, { scope: 'socket', userId: String(socket.data.user?._id) });
    });
    registerBiometricHandler(socket);
  });

  _io = io;
  return io;
}

function getIo() {
  return _io;
}

module.exports = { createSocketServer, getIo };

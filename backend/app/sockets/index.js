'use strict';

const { Server } = require('socket.io');
const cookie = require('cookie');
const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const { isRevoked } = require('../utils/tokenDenylist');
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

      // A logged-out (revoked-jti) token must not open a socket either — the
      // HTTP middleware already refuses it; this door has to match. (audit S8-1)
      if (payload.jti && (await isRevoked(payload.jti))) {
        return next(new Error('unauthorized'));
      }

      const user = await User.findById(payload.userId).select(
        '-spotifyToken -youtubeMusicToken -wearableToken'
      );

      if (!user || user.deletedAt) return next(new Error('unauthorized'));

      socket.data.user = user;
      // Sockets outlive JWTs. Remember the expiry so in-session packets can be
      // refused once the token dies instead of trusting the handshake forever,
      // and the jti so logout can kill exactly this token's socket. (audit S8-4)
      socket.data.tokenExp = payload.exp || null;
      socket.data.jti = payload.jti || null;
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
    // Refuse every packet that arrives after the handshake JWT expired: tell the
    // client why (so it can refresh + reconnect), then drop the connection. (audit S8-2)
    socket.use((packet, next) => {
      const exp = socket.data.tokenExp;
      if (exp && Date.now() / 1000 >= exp) {
        socket.emit('auth_expired');
        socket.disconnect(true);
        return; // swallow the packet — never reaches handlers
      }
      next();
    });
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

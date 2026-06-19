'use strict';

const { Server } = require('socket.io');
const cookie = require('cookie');
const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const User = require('../models/User');
const { registerBiometricHandler } = require('./biometricHandler');

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
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user._id}`);
    registerBiometricHandler(socket);
  });

  return io;
}

module.exports = { createSocketServer };

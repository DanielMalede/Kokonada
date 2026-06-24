'use strict';

const http = require('http');
const { createSocketServer, getIo } = require('../app/sockets');

describe('getIo', () => {
  it('returns null before any socket server is created', () => {
    // Jest gives each test file its own module registry, so the module-level
    // `_io` is fresh here and reliably null until createSocketServer runs below.
    expect(getIo()).toBeNull();
  });

  it('returns the same io instance created by createSocketServer', () => {
    const httpServer = http.createServer();
    const io = createSocketServer(httpServer);
    try {
      expect(getIo()).toBe(io);
    } finally {
      io.close();
      httpServer.close();
    }
  });
});

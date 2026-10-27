'use strict';

// No byte of a Garmin personal-lane test leaves the machine (RA-5).
//
// blockRealConnections() blocks createConnection on the http and https Agent PROTOTYPES as well as
// on the two global agents, for the test file that calls it. The prototypes matter: a client built
// with no httpsAgent makes an agent of its own, and a block on the global agents alone never saw it.
// An agent with a createConnection of its own (the fake Garmin's, which connects to 127.0.0.1) still
// connects, because an own property wins over the prototype.
//
// Each blocked attempt is recorded with where it would have gone and the TLS options it carried, so
// a test can prove a connection was attempted, and stopped, rather than never tried. The original
// properties are put back exactly after the file (the core modules are shared by every test file in
// a --runInBand run).

const http = require('http');
const https = require('https');

const BLOCKED_MESSAGE = 'a real network connection was attempted in a test';

function blockRealConnections() {
  const attempts = [];
  const saved = [];
  beforeAll(() => {
    for (const target of [http.Agent.prototype, https.Agent.prototype, http.globalAgent, https.globalAgent]) {
      saved.push([target, Object.getOwnPropertyDescriptor(target, 'createConnection')]);
      target.createConnection = function blockedConnection(options) {
        attempts.push({
          host: options?.host,
          port: Number(options?.port),
          servername: options?.servername,
          rejectUnauthorized: options?.rejectUnauthorized,
          minVersion: options?.minVersion,
        });
        throw new Error(BLOCKED_MESSAGE);
      };
    }
  });
  afterAll(() => {
    for (const [target, descriptor] of saved.splice(0).reverse()) {
      if (descriptor) Object.defineProperty(target, 'createConnection', descriptor);
      else delete target.createConnection;
    }
  });
  return attempts;
}

module.exports = { blockRealConnections, BLOCKED_MESSAGE };

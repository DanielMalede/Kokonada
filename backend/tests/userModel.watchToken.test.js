'use strict';

const User = require('../app/models/User');

describe('User.watchToken schema', () => {
  it('defines a string watchToken.hash path', () => {
    const path = User.schema.path('watchToken.hash');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
  });

  it('defines watchToken.createdAt and watchToken.lastSeenAt date paths', () => {
    const createdAt = User.schema.path('watchToken.createdAt');
    const lastSeenAt = User.schema.path('watchToken.lastSeenAt');
    expect(createdAt).toBeDefined();
    expect(lastSeenAt).toBeDefined();
    expect(createdAt.instance).toBe('Date');
    expect(lastSeenAt.instance).toBe('Date');
  });

  it('declares a sparse index on watchToken.hash', () => {
    const entry = User.schema.indexes().find(
      ([fields]) => Object.prototype.hasOwnProperty.call(fields, 'watchToken.hash')
    );
    expect(entry).toBeDefined();
    const [, options] = entry;
    expect(options.sparse).toBe(true);
  });
});

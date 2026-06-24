'use strict';

const User = require('../app/models/User');

describe('User.watchToken schema', () => {
  it('defines a string watchToken.hash path', () => {
    const path = User.schema.path('watchToken.hash');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
  });

  it('defines watchToken.createdAt and watchToken.lastSeenAt date paths', () => {
    expect(User.schema.path('watchToken.createdAt').instance).toBe('Date');
    expect(User.schema.path('watchToken.lastSeenAt').instance).toBe('Date');
  });

  it('declares an index on watchToken.hash', () => {
    const hasIndex = User.schema.indexes().some(
      ([fields]) => Object.prototype.hasOwnProperty.call(fields, 'watchToken.hash')
    );
    expect(hasIndex).toBe(true);
  });
});

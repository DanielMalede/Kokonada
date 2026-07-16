'use strict';

// T3.4 hygiene: fail LOUD if the process connects to the wrong Mongo database. In production a
// connection that landed on the implicit 'test' db almost always means MONGO_URI is missing its
// /dbname path — silently writing health data there would be a data-integrity disaster.
const connectDB = require('../app/config/db');
const { assertDbName } = connectDB;

const OLD_ENV = process.env.NODE_ENV;
const OLD_NAME = process.env.MONGO_DB_NAME;

afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = OLD_ENV;
  if (OLD_NAME === undefined) delete process.env.MONGO_DB_NAME; else process.env.MONGO_DB_NAME = OLD_NAME;
});

describe('assertDbName (startup DB-name guard)', () => {
  it('throws in production when connected to the default "test" database', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MONGO_DB_NAME;
    expect(() => assertDbName('test')).toThrow(/test/i);
  });

  it('throws when the connected name does not match the explicit expected name', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGO_DB_NAME = 'kokonada';
    expect(() => assertDbName('kokonada_staging')).toThrow(/kokonada/i);
  });

  it('passes when the connected name matches the expected name', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGO_DB_NAME = 'kokonada';
    expect(() => assertDbName('kokonada')).not.toThrow();
  });

  it('does not fail a non-production env on the default database (local dev/test)', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGO_DB_NAME;
    expect(() => assertDbName('test')).not.toThrow();
  });
});

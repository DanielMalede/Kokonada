'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const HealthSample = require('../app/models/HealthSample');

jest.setTimeout(120000);

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
});

afterEach(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});

afterAll(async () => {
  await mem.stop();
});

describe('HealthSample production index rollout boundary', () => {
  it('does not create application indexes merely because the registered model connects', async () => {
    await mongoose.connect(mem.getUri(), { dbName: 'health_sample_no_auto_index' });
    await HealthSample.init();

    const indexes = await HealthSample.collection.listIndexes().toArray();
    expect(indexes.map(({ name }) => name)).toEqual(['_id_']);
  });
});

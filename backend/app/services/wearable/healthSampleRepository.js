'use strict';

const HealthSample = require('../../models/HealthSample');
const {
  healthSampleKey,
  healthSampleKeyCandidates,
} = require('./healthSampleIdentity');

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function repositoryError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

const conflict = () => repositoryError('health_sample_identity_conflict', 409);
const outsideRetention = () => repositoryError('health_sample_outside_retention', 422);
const millis = (value) => new Date(value).getTime();
const optionalNumber = (value) => (value == null ? null : Number(value));

function contentOf(sample) {
  return {
    metric: sample.type,
    method: sample.method ?? null,
    value: Number(sample.value),
    unit: sample.unit,
    startAt: millis(sample.startDate),
    endAt: millis(sample.endDate),
    tzOffsetMinutes: optionalNumber(sample.tzOffsetMinutes),
  };
}

function sameContent(left, right) {
  return left.metric === right.metric
    && left.method === right.method
    && Object.is(left.value, right.value)
    && left.unit === right.unit
    && left.startAt === right.startAt
    && left.endAt === right.endAt
    && left.tzOffsetMinutes === right.tzOffsetMinutes;
}

function rowContent(row) {
  return {
    metric: row.metric,
    method: row.method ?? null,
    value: Number(row.value),
    unit: row.unit,
    startAt: row.startAt?.getTime(),
    endAt: row.endAt?.getTime(),
    tzOffsetMinutes: optionalNumber(row.tzOffsetMinutes),
  };
}

function reduceOperations(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const id = String(sample.sampleId);
    const group = groups.get(id) || [];
    group.push(sample);
    groups.set(id, group);
  }

  return [...groups.entries()].map(([sampleId, operations]) => {
    if (operations.some((sample) => sample.operation === 'delete')) {
      return { sampleId, operation: 'delete' };
    }

    const winner = operations[0];
    const expected = contentOf(winner);
    if (operations.some((sample) => !sameContent(expected, contentOf(sample)))) throw conflict();
    return winner;
  });
}

async function findExisting(userId, source, sampleId) {
  const currentKey = healthSampleKey(userId, source, sampleId);
  let row = await HealthSample.findOne({ userId, source, sampleKey: currentKey });
  if (row) return { row, currentKey };

  const previousKeys = healthSampleKeyCandidates(userId, source, sampleId)
    .filter((candidate) => candidate !== currentKey);
  if (!previousKeys.length) return { row: null, currentKey };

  row = await HealthSample.findOne({ userId, source, sampleKey: { $in: previousKeys } });
  if (!row) return { row: null, currentKey };

  row.sampleKey = currentKey;
  try {
    await row.save();
    return { row, currentKey };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    row = await HealthSample.findOne({ userId, source, sampleKey: currentKey });
    if (!row) throw error;
    return { row, currentKey };
  }
}

function notePending(row, currentKey, pendingKeys) {
  if (row.projectionState === 'pending') pendingKeys.add(currentKey);
}

async function applyExistingUpsert(row, sample, currentKey, pendingKeys, counts) {
  if (row.state === 'deleted') {
    counts.replayed += 1;
    notePending(row, currentKey, pendingKeys);
    return;
  }
  if (!sameContent(rowContent(row), contentOf(sample))) throw conflict();
  counts.replayed += 1;
  notePending(row, currentKey, pendingKeys);
}

async function applyUpsert(userId, source, sample, now, pendingKeys, counts) {
  const endAt = new Date(sample.endDate);
  const expiresAt = new Date(endAt.getTime() + RETENTION_MS);
  if (expiresAt.getTime() <= now.getTime()) throw outsideRetention();

  const found = await findExisting(userId, source, sample.sampleId);
  if (found.row) {
    await applyExistingUpsert(found.row, sample, found.currentKey, pendingKeys, counts);
    return;
  }

  try {
    const row = await HealthSample.create({
      userId,
      sampleKey: found.currentKey,
      source,
      metric: sample.type,
      method: sample.method ?? null,
      value: Number(sample.value),
      unit: sample.unit,
      startAt: new Date(sample.startDate),
      endAt,
      tzOffsetMinutes: optionalNumber(sample.tzOffsetMinutes),
      state: 'active',
      projectionState: 'pending',
      deletedAt: null,
      expiresAt,
    });
    counts.created += 1;
    notePending(row, found.currentKey, pendingKeys);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const winner = await findExisting(userId, source, sample.sampleId);
    if (!winner.row) throw error;
    await applyExistingUpsert(winner.row, sample, winner.currentKey, pendingKeys, counts);
  }
}

async function applyExistingDelete(row, now, currentKey, pendingKeys, counts) {
  if (row.state === 'deleted') {
    counts.replayed += 1;
    notePending(row, currentKey, pendingKeys);
    return;
  }

  row.state = 'deleted';
  row.deletedAt = now;
  row.projectionState = 'pending';
  await row.save();
  counts.deleted += 1;
  notePending(row, currentKey, pendingKeys);
}

async function applyDelete(userId, source, sample, now, pendingKeys, counts) {
  const found = await findExisting(userId, source, sample.sampleId);
  if (found.row) {
    await applyExistingDelete(found.row, now, found.currentKey, pendingKeys, counts);
    return;
  }

  try {
    const row = await HealthSample.create({
      userId,
      sampleKey: found.currentKey,
      source,
      state: 'deleted',
      projectionState: 'pending',
      deletedAt: now,
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    });
    counts.deleted += 1;
    notePending(row, found.currentKey, pendingKeys);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const winner = await findExisting(userId, source, sample.sampleId);
    if (!winner.row) throw error;
    await applyExistingDelete(winner.row, now, winner.currentKey, pendingKeys, counts);
  }
}

async function applyHealthOperations(userId, source, samples, { now = new Date() } = {}) {
  const operations = reduceOperations(samples);
  const pendingKeys = new Set();
  const counts = { created: 0, replayed: 0, deleted: 0 };

  for (const sample of operations) {
    if (sample.operation === 'delete') {
      await applyDelete(userId, source, sample, now, pendingKeys, counts);
    } else {
      await applyUpsert(userId, source, sample, now, pendingKeys, counts);
    }
  }

  return {
    accepted: samples.length,
    ...counts,
    pendingKeys: [...pendingKeys],
  };
}

module.exports = { applyHealthOperations };

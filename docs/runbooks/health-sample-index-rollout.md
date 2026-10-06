# HealthSample production indexes — Pause & Guide

This runbook prepares the authoritative Apple Health / Health Connect sample store for production. It does **not** authorize an agent to change MongoDB Atlas. Daniel or Malede performs every production step and visually verifies the result in Atlas.

## Expected indexes

The `healthsamples` collection needs these application indexes in addition to MongoDB's `_id_` index:

| Name | Keys | Options | Purpose |
|---|---|---|---|
| `userId_1_source_1_sampleKey_1` | `{ userId: 1, source: 1, sampleKey: 1 }` | `unique: true` | Makes one HealthKit/Health Connect sample identity unique per user and source. |
| `projectionState_1_updatedAt_1` | `{ projectionState: 1, updatedAt: 1 }` | none | Lets the repair worker scan the oldest pending projections without scanning the collection. |
| `expiresAt_1` | `{ expiresAt: 1 }` | `expireAfterSeconds: 0` | Absolute TTL: MongoDB removes a row after its application-computed `expiresAt` date. |

The application computes active-sample expiry from the sample's end time and tombstone expiry from deletion receipt time, both at 90 days. Do not replace the absolute TTL with a relative TTL value.

## Before touching Atlas

1. Confirm the selected Atlas project, cluster and database are the Kokonada production targets. Stop if any name is uncertain.

2. Confirm the deployed or planned application commit contains the `HealthSample` schema and repository from PR #232. Do not create indexes for a different schema draft.

3. In Atlas, open the `healthsamples` collection and inspect its current document count and index list. Save a screenshot or operations note with the date, cluster, database, count and existing indexes.

4. Confirm a current Atlas backup or recovery policy. Index rollback cannot restore documents already removed by a TTL index.

5. Run the duplicate preflight below in the Atlas shell or another owner-approved read-only MongoDB console:

```javascript
db.healthsamples.aggregate([
  {
    $group: {
      _id: { userId: '$userId', source: '$source', sampleKey: '$sampleKey' },
      count: { $sum: 1 },
      ids: { $push: '$_id' }
    }
  },
  { $match: { count: { $gt: 1 } } },
  { $limit: 20 }
])
```

The required result is zero rows. If any duplicate appears, **stop**. Do not delete or merge it during this runbook; investigate which ingest version wrote it and prepare a separately reviewed repair.

6. Check for malformed rows before enabling TTL or uniqueness:

```javascript
db.healthsamples.countDocuments({
  $or: [
    { userId: { $exists: false } },
    { source: { $nin: ['apple_health', 'health_connect'] } },
    { sampleKey: { $not: /^[0-9a-f]{64}$/ } },
    { $expr: { $ne: [{ $type: '$expiresAt' }, 'date'] } }
  ]
})
```

The required result is `0`. Stop on any other value. Note that `$not` with a regular expression also catches missing or non-string keys; the explicit `userId` check keeps the failure reason visible.

## Create the indexes

Prefer the Atlas **Collections → Indexes** UI so the owner can visually confirm every key and option before creation. Create one index at a time in the table order above and wait until Atlas reports it ready before starting the next.

Equivalent `mongosh` commands are shown for review and for owner-approved execution:

```javascript
db.healthsamples.createIndex(
  { userId: 1, source: 1, sampleKey: 1 },
  { name: 'userId_1_source_1_sampleKey_1', unique: true }
)

db.healthsamples.createIndex(
  { projectionState: 1, updatedAt: 1 },
  { name: 'projectionState_1_updatedAt_1' }
)

db.healthsamples.createIndex(
  { expiresAt: 1 },
  { name: 'expiresAt_1', expireAfterSeconds: 0 }
)
```

Do not run Mongoose `syncIndexes()` in production: it may drop indexes outside this runbook.

## Verification

1. In Atlas, verify `_id_` and all three application indexes above are present and ready. Open each application index and visually confirm key order, uniqueness and `expireAfterSeconds: 0` exactly. Do not remove unrelated indexes during this procedure.

2. Record the output of:

```javascript
db.healthsamples.getIndexes()
```

3. If the collection has pending rows, verify the repair query selects the compound index:

```javascript
db.healthsamples.find({ projectionState: 'pending' })
  .sort({ updatedAt: 1 })
  .limit(100)
  .explain('executionStats')
```

The winning plan must use `projectionState_1_updatedAt_1`, not a collection scan. An empty collection may not provide meaningful execution statistics; in that case the Atlas index definition is the evidence and the query is repeated after safe test data exists.

4. After the application is deployed and a signed iPhone test is authorized, verify that retrying the same sample does not create a second row, a deletion becomes a tombstone, and the repair backlog returns to zero. Do not use real production health data merely to test index creation.

5. Daniel or Malede records the Atlas screenshot/operations note and the exact application commit. A successful CLI command without visual Atlas confirmation is not completion.

## Stop and rollback rules

Stop immediately if duplicates or malformed rows exist, an index with the same name has different keys/options, Atlas targets the wrong cluster/database, index creation fails, or application CI is not green on the deployment commit.

For an index that is still building, cancel it in Atlas if available and record the error. For a completed **non-TTL** index created by this runbook, the owner may drop that exact index name after confirming no deployment depends on it. Do not drop `_id_` or any pre-existing index.

Treat the TTL index differently: dropping `expiresAt_1` stops future expiry but cannot restore documents MongoDB already deleted. If its definition is wrong, stop ingest/deployment, preserve evidence, drop only `expiresAt_1` with owner approval, correct the schema/runbook in a new PR, and assess recovery from backup before proceeding.

Never delete duplicate documents, change `expiresAt`, disable production backups, or mutate unrelated indexes as part of this runbook.

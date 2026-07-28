"use strict";
// A SQLite-backed implementation of @did-plc/server's `PlcDatabase` interface.
//
// The upstream directory server only ships a Postgres store (and an in-memory
// mock). We inject this instead of Database.postgres() so a self-contained,
// no-Postgres dev PLC can accept and serve did:plc operations. All operation
// *validation* still runs through @did-plc/lib (assureValidNextOp) exactly as
// the Postgres path does — this class only changes where ops are stored.
//
// Logic mirrors @did-plc/server@0.0.1 dist/db/index.js (the Postgres Database
// class): validate → cid → insert → nullify superseded → assert prev matches.

const Database = require("better-sqlite3");
const { CID } = require("multiformats/cid");
const { cidForCbor } = require("@atproto/common");
const plc = require("@did-plc/lib");

// The server's error.handler recognizes errors structurally — ServerError.is()
// only checks for a string `message` and numeric `status` — so a plain Error
// with `.status` is formatted with the right code without importing their class
// (the dist is bundled; there is no standalone error module to import).
function serverError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

class SqliteDatabase {
  constructor(location) {
    this.db = new Database(location);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        did TEXT NOT NULL,
        operation TEXT NOT NULL,
        cid TEXT NOT NULL,
        nullified INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        UNIQUE(did, cid)
      );
      CREATE INDEX IF NOT EXISTS operations_did_idx ON operations(did);
      CREATE INDEX IF NOT EXISTS operations_createdat_idx ON operations(createdAt);
    `);
  }

  async close() {
    this.db.close();
  }

  async healthCheck() {
    this.db.prepare("SELECT 1").get();
  }

  // Ordering matches the pg store: createdAt asc, id asc as a stable tiebreaker
  // for ops written within the same millisecond (re-seeding writes bursts).
  async indexedOpsForDid(did, includeNullified = false) {
    const rows = this.db
      .prepare(
        `SELECT did, operation, cid, nullified, createdAt FROM operations
           WHERE did = ?${includeNullified ? "" : " AND nullified = 0"}
           ORDER BY createdAt ASC, id ASC`,
      )
      .all(did);
    return rows.map((row) => ({
      did: row.did,
      operation: JSON.parse(row.operation),
      // assureValidNextOp does proposedPrev.equals(op.cid), so cid must be a CID.
      cid: CID.parse(row.cid),
      nullified: row.nullified === 1,
      createdAt: new Date(row.createdAt),
    }));
  }

  async opsForDid(did) {
    const ops = await this.indexedOpsForDid(did);
    return ops.map((op) => op.operation);
  }

  async lastOpForDid(did) {
    const row = this.db
      .prepare(
        `SELECT operation FROM operations
           WHERE did = ? AND nullified = 0
           ORDER BY createdAt DESC, id DESC LIMIT 1`,
      )
      .get(did);
    return row ? JSON.parse(row.operation) : null;
  }

  async exportOps(count, after) {
    const rows = after
      ? this.db
          .prepare(
            `SELECT * FROM operations WHERE createdAt > ?
               ORDER BY createdAt ASC, id ASC LIMIT ?`,
          )
          .all(after.toISOString(), count)
      : this.db
          .prepare(
            `SELECT * FROM operations ORDER BY createdAt ASC, id ASC LIMIT ?`,
          )
          .all(count);
    return rows.map((row) => ({
      did: row.did,
      operation: JSON.parse(row.operation),
      cid: row.cid,
      nullified: row.nullified === 1,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  async validateAndAddOp(did, proposed) {
    const ops = await this.indexedOpsForDid(did);
    // Validation is identical to the Postgres path — hash-chain + signatures.
    const { nullified, prev } = await plc.assureValidNextOp(did, ops, proposed);
    const cid = await cidForCbor(proposed);
    const cidStr = cid.toString();
    const createdAt = new Date().toISOString();

    // better-sqlite3 is synchronous and serializes writers, so the insert,
    // nullification, and prev-match assertion run atomically in one txn.
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO operations (did, operation, cid, nullified, createdAt)
             VALUES (?, ?, ?, 0, ?)`,
        )
        .run(did, JSON.stringify(proposed), cidStr, createdAt);

      if (nullified.length > 0) {
        const strs = nullified.map((c) => c.toString());
        const placeholders = strs.map(() => "?").join(", ");
        this.db
          .prepare(
            `UPDATE operations SET nullified = 1
               WHERE did = ? AND cid IN (${placeholders})`,
          )
          .run(did, ...strs);
      }

      const mostRecent = this.db
        .prepare(
          `SELECT cid FROM operations
             WHERE did = ? AND nullified = 0
             ORDER BY createdAt DESC, id DESC LIMIT 2`,
        )
        .all(did);
      // Compare by CID string rather than CID.equals to stay independent of
      // which multiformats copy resolved.
      const isMatch =
        (prev === null && !mostRecent[1]) ||
        (prev && mostRecent[1] && prev.toString() === mostRecent[1].cid);
      if (!isMatch) {
        throw serverError(
          409,
          "Proposed prev does not match the most recent operation",
        );
      }
    });
    write();
  }
}

module.exports = { SqliteDatabase };

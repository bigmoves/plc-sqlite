"use strict";
// End-to-end check of the SQLite PLC store, no PDS required:
//   1. create a did:plc genesis op  → validateAndAddOp (prev === null path)
//   2. resolve the DID document      → opsForDid / formatDidDoc
//   3. apply a handle-update op      → 2-op chain: assureValidNextOp reads
//      indexedOpsForDid, so op.cid must round-trip through CID.parse
//   4. resolve again, assert the handle changed
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { PlcServer } = require("@did-plc/server");
const { Client, updateHandleOp } = require("@did-plc/lib");
const { Secp256k1Keypair } = require("@atproto/crypto");
const { SqliteDatabase } = require("../sqlite-db");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plc-sqlite-"));
  const dbPath = path.join(dir, "plc.db");
  const db = new SqliteDatabase(dbPath);
  const server = PlcServer.create({ db, port: 0, version: "test" });
  const http = await server.start();
  const port = http.address().port;
  const client = new Client(`http://localhost:${port}`);

  try {
    const signingKey = await Secp256k1Keypair.create();
    const rotationKey = await Secp256k1Keypair.create();

    const did = await client.createDid({
      signingKey: signingKey.did(),
      rotationKeys: [rotationKey.did()],
      handle: "alice.test",
      pds: "https://pds.example.com",
      signer: rotationKey,
    });
    assert.ok(did.startsWith("did:plc:"), `expected did:plc, got ${did}`);
    console.log(`[smoke] created ${did}`);

    const doc = await client.getDocument(did);
    assert.strictEqual(doc.id, did);
    assert.ok(
      doc.alsoKnownAs.includes("at://alice.test"),
      `handle not in doc: ${JSON.stringify(doc.alsoKnownAs)}`,
    );
    console.log(`[smoke] resolved doc, handle alice.test ✓`);

    // Second op: exercises the prev chain + CID.parse round-trip.
    const lastOp = await client.getLastOp(did);
    const op2 = await updateHandleOp(lastOp, rotationKey, "alice2.test");
    await client.sendOperation(did, op2);

    const doc2 = await client.getDocument(did);
    assert.ok(
      doc2.alsoKnownAs.includes("at://alice2.test"),
      `handle not updated: ${JSON.stringify(doc2.alsoKnownAs)}`,
    );
    const log = await client.getOperationLog(did);
    assert.strictEqual(log.length, 2, `expected 2 ops, got ${log.length}`);
    console.log(`[smoke] handle updated to alice2.test, 2-op log ✓`);

    console.log("\n[smoke] PASS — SQLite PLC validates, stores, and serves ops");
  } finally {
    await server.destroy();
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});

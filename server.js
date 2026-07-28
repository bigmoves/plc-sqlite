"use strict";
// Boots the upstream @did-plc/server HTTP app against a SQLite store.
// The directory server is unchanged; only its database is swapped (see
// sqlite-db.js). Env:
//   PORT          - listen port (default 3000)
//   PLC_DB_PATH   - sqlite file (default <PLC_DATA_DIR>/plc.db)
//   PLC_DATA_DIR  - dir for the sqlite file (default /data, a mounted volume)

const fs = require("fs");
const path = require("path");
const { PlcServer } = require("@did-plc/server");
const { SqliteDatabase } = require("./sqlite-db");

const dataDir = process.env.PLC_DATA_DIR || "/data";
const dbPath = process.env.PLC_DB_PATH || path.join(dataDir, "plc.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new SqliteDatabase(dbPath);
const port = Number(process.env.PORT) || 3000;
const server = PlcServer.create({
  db,
  port,
  version: process.env.PLC_VERSION || "0.0.1-sqlite",
});

server
  .start()
  .then((s) => {
    const addr = s.address();
    const p = typeof addr === "object" && addr ? addr.port : addr;
    console.log(`[plc-sqlite] listening on ${p}, db=${dbPath}`);
  })
  .catch((err) => {
    console.error("[plc-sqlite] failed to start:", err);
    process.exit(1);
  });

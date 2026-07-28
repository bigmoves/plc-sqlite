# plc-sqlite

A [`did:plc`](https://github.com/did-method-plc/did-method-plc) directory server backed by SQLite instead of Postgres.

The upstream `@did-plc/server` ships two stores: Postgres, and an in-memory mock that forgets everything on restart. Neither suits a self-contained dev or preview environment, where you want a real directory that survives a redeploy without running a database alongside it. This package supplies a third: a `PlcDatabase` implementation over a single SQLite file, injected into the unmodified upstream HTTP server.

Operation *validation* is untouched. Every write still goes through `@did-plc/lib`'s `assureValidNextOp` — hash chain, signatures, rotation-key authority — exactly as the Postgres path does. Only the storage changes.

## Run it

With Docker:

```sh
docker run -p 3000:3000 -v plc-data:/data ghcr.io/bigmoves/plc-sqlite:0.0.1
```

From source:

```sh
npm ci
PLC_DATA_DIR=./data npm start
```

Then point a PDS at it with `PDS_DID_PLC_URL=http://localhost:3000`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `PLC_DATA_DIR` | `/data` | Directory for the SQLite file — mount a volume here |
| `PLC_DB_PATH` | `$PLC_DATA_DIR/plc.db` | Full path to the SQLite file, overriding `PLC_DATA_DIR` |
| `PLC_VERSION` | `0.0.1-sqlite` | Version string reported by the server |

The container declares `VOLUME ["/data"]`. Without a mount, DIDs vanish with the container.

## Test

```sh
npm test
```

The smoke test boots the server on an ephemeral port, creates a genesis operation, resolves the DID document, applies a handle update, and asserts the two-operation log — covering the `prev === null` path, the CID round-trip through `CID.parse`, and the hash chain. No PDS or network required.

## Scope

This is a directory for environments you control: local development, ephemeral PR previews, integration tests. It is authoritative only for the PDSes you point at it. DIDs minted here are unknown to `plc.directory` and unresolvable anywhere else.

It also inherits the upstream server's posture — no authentication, no rate limiting — so it belongs on a private network or behind your own edge, not on the open internet. Backup is whatever you do with the SQLite file.

Writes are serialized by `better-sqlite3`'s synchronous API, which is what makes the insert / nullify / prev-assert sequence atomic in one transaction. That means one process per database file.

## Compatibility

Pinned to `@did-plc/server@0.0.1` and `@did-plc/lib@0.0.4`. `sqlite-db.js` mirrors the logic in that version's `dist/db/index.js`, and it recognizes the server's errors structurally rather than importing them (the dist is bundled, with no standalone error module). Upstream bumps need a read of the diff, not just a version change.

## Acknowledgements

The directory server itself is the [did-method-plc](https://github.com/did-method-plc/did-method-plc) reference implementation by Bluesky Social PBC, dual MIT/Apache-2.0 licensed. This project is not a fork of it: `@did-plc/server` and `@did-plc/lib` are installed as unmodified npm dependencies, and the SQLite store is passed in through the constructor the server already exposes.

`sqlite-db.js` is written from scratch against that interface, but its control flow follows the upstream Postgres store in `@did-plc/server@0.0.1` and is derived from reading it. See [`NOTICE`](NOTICE).

## License

MIT — see [`LICENSE`](LICENSE). Upstream attribution is in [`NOTICE`](NOTICE).

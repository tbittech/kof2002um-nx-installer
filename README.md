# kof2002um-nx installer

Web page (GitHub Pages) that builds the Nintendo Switch package of
[kof2002um-nx](https://github.com/tbittech/kof2002um-nx) from the user's own Xbox 360 copy of
The King of Fighters 2002 Unlimited Match. Everything runs in the browser; nothing is uploaded.

What it does, all in a Web Worker:

1. Reads the XBLA STFS package (title `584109AD`), locating every data block by its SHA-1 like
   `tools/kof_stfs_extract.py` of the port (it also accepts the already extracted folder).
2. Decompresses the XCTD (LZX) files, as `tools/xctd/` does.
3. Writes `game.nxpack` + `game.nxidx` (the SDK's PackDevice format, version 2). The data is read twice:
   the first pass gets the sizes and the data checksum that the pack header needs.
4. Streams a stored zip (`kof2002um-nx/…`) to a normal download through a service worker (`sw.js`); browsers
   without service workers get the zip built in memory.

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | The page (English / Spanish) |
| `worker.js` | Runs the build |
| `sw.js` | Streams the zip to the download |
| `lib/stfs.js`, `lib/xctd.js`, `lib/lzx.js`, `lib/build.js`, `lib/hash.js` | STFS reader, XCTD + LZX decoder, pack and zip writers, SHA-1 / FNV-1a / CRC-32 |
| `release/manifest.json` | The files of the current release that go into the zip next to the game data |
| `release/kof2002um_nx.toml` | Runtime settings |

`lib/lzx.js` is a port of libmspack's `lzxd.c` and is under the LGPL 2.1 (`lib/LICENSE-LGPL`).

## Publishing a new build

Copy the new `.nro` and `.toml` into `release/` and list them in `release/manifest.json` with their exact sizes:

```json
{
  "version": "2026-11-07",
  "files": [
    { "name": "kof2002um-nx.nro", "size": 65276101 },
    { "name": "kof2002um_nx.toml", "size": 856 }
  ]
}
```

With an `.nro` listed, the page also offers `kof2002um-nx-update.zip` (only the `.nro` and `.toml`).

## Testing

Open the page with `#selftest` at the end of the URL: the zip is built and streamed but not saved, and the log
shows how many bytes came out.

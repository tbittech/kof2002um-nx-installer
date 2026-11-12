# kof2002um-nx installer — estado

## 2026-11-12 (2): build 20261111b y juego completo

- El push del keep-alive anduvo: el usuario bajó el zip completo.
- `release/` ahora trae la build `kof2002um-nx/switch/kof2002um-nx-20261111b` (la que tiene la grilla de personajes): NRO de 65.317.061 B y toml de 1222 B; `manifest.json` 2026-11-12.
- El juego mostraba "Unlock Full Game" (modo prueba) porque el cvar `license_mask` del SDK vale 0. Se agregó `license_mask = 1` al toml (también al de la carpeta 20261111b). El NRO trae el cvar, pero falta probarlo en la consola.

## 2026-11-12: zip cortado en la descarga real

- El usuario bajó `kof2002um-nx.zip` desde Pages: 1.063.083.190 B de 1.157.826.914; se corta dentro de `game.nxpack` y le falta el directorio central (WinRAR: corrupto). La página quedó en "99 %".
- Causa probable: Chrome mata el service worker (unos 30 s inactivo, 5 min como tope por evento). El stream le llega por MessageChannel, que no cuenta como actividad. En headless tardó 40 s y no saltaba; en la PC real el pase de escritura tarda minutos.
- Arreglo en `app.js`: ping `{type:'ping'}` al SW cada 10 s mientras dura la descarga (como StreamSaver.js); para en done o error. Sin commit, sin push y sin probar con una descarga larga.

## 2026-11-07 (3): publicado

- Repo https://github.com/tbittech/kof2002um-nx-installer (público), Pages desde `main` `/`: https://tbittech.github.io/kof2002um-nx-installer/
- Arreglo: autocrlf guardaba el toml con LF (826 B) y el manifest pide 856 → el worker abortaba en Pages. `.gitattributes` con `release/** -text`; ahora se sirve con 856 B.
- Verificado en vivo: index, sw.js, manifest, toml (856) y NRO (65.276.101). Falta una corrida completa en el sitio publicado con el paquete real.

## 2026-11-07 (2): SW probado, falta el push

- Service worker probado con Chrome headless por CDP (script `swtest.mjs`: abre `#selftest`, recarga para tener controller, mete el paquete con DataTransfer, pulsa Crear): `selftest: 1157826914 bytes streamed, Content-Length 1157826914`, 40 s. Aviso conocido del paquete: falta 1 bloque en `data/B/bg/bgj1.bin` (se rellena con ceros).
- El usuario pidió subirlo a GitHub con Pages (dominio github.io). `gh repo create … --push` lo bloqueó el clasificador de auto mode; hay que correrlo a mano o darle permiso.
- `release/kof2002um_nx.toml` sale modificado solo por CRLF; no commitear.
- **Próximo paso**: `gh repo create tbittech/kof2002um-nx-installer --public --source . --remote origin --push`, después activar Pages (`main`, `/`) y abrir `https://tbittech.github.io/kof2002um-nx-installer/`.

## 2026-11-07: página instaladora hecha, falta publicar

**Hecho**
- Página estática al estilo de stevensnd.github.io/nfsmw-nx-installer. Lee el paquete XBLA (STFS, bloques ubicados por SHA-1) o la carpeta extraída, descomprime XCTD con `lib/lzx.js` (port propio de lzxd.c, LGPL), arma `game.nxpack` + `game.nxidx` en dos pasadas y descarga un zip sin compresión `kof2002um-nx/…`. Todo corre en un worker.
- Verificado con el paquete real (`D:/Ports Swtch/The King of Fighters 2002 Unlimited Match/584109AD/000D0000/308C…`): 1259 archivos idénticos a `kof2002um-nx/switch/kof2002um-nx-xctd/game.nxpack`, mismo tamaño y checksum de datos; el zip pasa testzip y `build_asset_pack.verify`. En el navegador integrado tarda ~60 s (camino en memoria).
- `release/` trae el NRO 60fps (`kof2002um-nx-60fps.nro` renombrado a `kof2002um-nx.nro`, 65.276.101 B) y el toml 60fps; `manifest.json` los lista con sus tamaños.
- Repo git local creado y con commit; no hay remoto todavía.

**Ojo**
- La base FNV del port es `1469598103934665603` (no la estándar); la consola la compara.
- Está en un repo aparte porque `export_github.py` vacía `kof2002um-nx-github/`.
- No tocar `kof2002um-nx-github/PORT_STATUS.md` por cosas de GitHub.

**Sin probar**: la descarga por streaming con service worker (`sw.js`). El navegador integrado no admite SW y Chrome no estaba conectado. Para probarla: servir la carpeta (`.claude/launch.json` → `kof-installer`, puerto 8765) y abrir `http://localhost:8765/kof2002um-nx-installer/#selftest` en Chrome; pasarle el paquete con DataTransfer al `#pickPackage` y pulsar Crear; el log debe decir `selftest: 1092550663+NRO bytes streamed`.

**Próximo paso**: probar el SW en Chrome, luego (con OK del usuario) crear el repo `tbittech/kof2002um-nx-installer` en GitHub, hacer push y activar Pages desde la raíz de `main`.

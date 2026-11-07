# kof2002um-nx installer — estado

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

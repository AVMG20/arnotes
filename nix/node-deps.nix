{
  lib,
  stdenv,
  bun,
}:
{
  pname,
  version,
  src,
  hash,
  frozen ? false,
}:
stdenv.mkDerivation {
  inherit pname version src;

  # Fixed-output: the npm registry is reachable from fixed-output derivations
  # even when the sandbox is on, so vendoring node_modules here keeps the real
  # app builds fully hermetic and offline.
  outputHash = hash;
  outputHashMode = "recursive";
  outputHashAlgo = "sha256";

  # node_modules is full of `#!/usr/bin/env ...` scripts; the fixup phase would
  # patch their shebangs to store paths, which a fixed-output derivation must
  # not reference. The deps are used as-is by bun.
  dontFixup = true;

  nativeBuildInputs = [ bun ];

  buildPhase = ''
    export HOME="$TMPDIR"
    export BUN_INSTALL_CACHE_DIR="$TMPDIR/.bun-cache"
    bun install ${lib.optionalString frozen "--frozen-lockfile"} --ignore-scripts --no-save
  '';

  installPhase = ''
    mkdir -p "$out"
    cp -r node_modules "$out/node_modules"
    cp package.json "$out/package.json"
    ${lib.optionalString frozen "cp bun.lock \"$out/bun.lock\""}
  '';

  meta = {
    description = "Vendored node_modules for ${pname}";
    platforms = lib.platforms.unix;
  };
}
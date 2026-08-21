{
  lib,
  stdenv,
  bun,
  nodeDeps,
}:
let
  versions = {
    "drizzle-kit" = "0.31.10";
    "drizzle-orm" = "0.45.2";
    postgres = "3.4.9";
  };

  pkgJson = builtins.toFile "package.json" (builtins.toJSON {
    name = "arnotes-schema";
    private = true;
    dependencies = versions;
  });
in
stdenv.mkDerivation (finalAttrs: {
  pname = "arnotes-schema";
  version = "0.1.0";

  # The schema tooling stands alone, exactly like the Docker `database` stage:
  # just the Drizzle config, the schema definition, and the three pinned
  # packages it needs to push that schema to PostgreSQL.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../drizzle.config.ts
      ../server/db/schema.ts
    ];
  };

  nativeBuildInputs = [ bun ];

  buildPhase = ''
    export HOME="$TMPDIR"
    export BUN_INSTALL_CACHE_DIR="$TMPDIR/.bun-cache"
    cp "${pkgJson}" package.json
    cp -r "${nodeDeps}/node_modules" node_modules
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/share/arnotes-schema"
    cp drizzle.config.ts package.json "$out/share/arnotes-schema/"
    cp -r server "$out/share/arnotes-schema/server"
    cp -r node_modules "$out/share/arnotes-schema/node_modules"

    mkdir -p "$out/bin"
    cat > "$out/bin/arnotes-db-push" <<EOF
    #!/usr/bin/env bash
    set -euo pipefail
    cd "$out/share/arnotes-schema"
    exec "${bun}/bin/bunx" drizzle-kit push --force "\$@"
    EOF
    chmod +x "$out/bin/arnotes-db-push"

    runHook postInstall
  '';

  meta = {
    description = "Drizzle schema tooling for Arnotes (drizzle-kit push).";
    homepage = "https://github.com/AVMG20/arnotes";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
})
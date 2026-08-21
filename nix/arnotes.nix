{
  lib,
  stdenv,
  bun,
  nodeDeps,
  makeWrapper,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "arnotes";
  version = "0.1.0";

  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let
        base = baseNameOf path;
      in !(
        builtins.elem base [
          ".git"
          ".codegraph"
          "node_modules"
          ".output"
          ".nuxt"
          ".nitro"
          ".data"
          ".cache"
          "dist"
          "data"
          "result"
        ]
        || base == ".env"
        || (lib.hasPrefix ".env." base && base != ".env.example")
      );
  };

  nativeBuildInputs = [ bun makeWrapper ];

  # node_modules is fetched offline from the vendored FOD; this phase only
  # reproduces the Docker builder's `bun run build` on top of it. The
  # postinstall (nuxt prepare) is run explicitly because scripts were ignored
  # when the deps were fetched.
  buildPhase = ''
    export HOME="$TMPDIR"
    export BUN_INSTALL_CACHE_DIR="$TMPDIR/.bun-cache"
    export NUXT_TELEMETRY_DISABLED=1
    cp -r "${nodeDeps}/node_modules" node_modules
    chmod -R u+w node_modules
    bun ./node_modules/nuxt/bin/nuxt.mjs prepare
    bun ./node_modules/nuxt/bin/nuxt.mjs build
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/arnotes"
    cp -r .output "$out/lib/arnotes/.output"

    mkdir -p "$out/bin"
    makeWrapper "${bun}/bin/bun" "$out/bin/arnotes" \
      --set-default NODE_ENV production \
      --set-default HOST 0.0.0.0 \
      --set-default PORT 3000 \
      --add-flags "$out/lib/arnotes/.output/server/index.mjs"

    runHook postInstall
  '';

  meta = {
    description = "A self-hosted, tag-based note-taking application.";
    homepage = "https://github.com/AVMG20/arnotes";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
    mainProgram = "arnotes";
  };
})
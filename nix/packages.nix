{
  pkgs,
  system,
}:
let
  mkNodeDeps = pkgs.callPackage ./node-deps.nix { };

  # node_modules contains platform-specific optional dependencies, so each build
  # platform has its own content hash. The known hashes live in hashes.json and
  # are kept up to date by .github/workflows/nix-hashes.yml; a platform without
  # a hash yet reports the correct value on its first build — paste it in or
  # run that workflow.
  hashes = builtins.fromJSON (builtins.readFile ./hashes.json);

  nodeDepsHash = hashes.node-deps.${system} or pkgs.lib.fakeHash;
  schemaDepsHash = hashes.schema-deps.${system} or pkgs.lib.fakeHash;

  nodeDeps = mkNodeDeps {
    pname = "arnotes-node-deps";
    version = "0.1.0";
    frozen = true;
    src = pkgs.lib.fileset.toSource {
      root = ../.;
      fileset = pkgs.lib.fileset.unions [
        ../package.json
        ../bun.lock
      ];
    };
    hash = nodeDepsHash;
  };

  schemaDeps = mkNodeDeps {
    pname = "arnotes-schema-node-deps";
    version = "0.1.0";
    src = pkgs.runCommand "arnotes-schema-manifest" { } ''
      mkdir -p "$out"
      cp ${builtins.toFile "package.json" (builtins.toJSON {
        name = "arnotes-schema";
        private = true;
        dependencies = {
          "drizzle-kit" = "0.31.10";
          "drizzle-orm" = "0.45.2";
          postgres = "3.4.9";
        };
      })} "$out/package.json"
    '';
    hash = schemaDepsHash;
  };
in
{
  inherit nodeDeps;
  arnotes = pkgs.callPackage ./arnotes.nix { inherit nodeDeps; };
  schema = pkgs.callPackage ./schema.nix { nodeDeps = schemaDeps; };

  # Updater variants that always force a wrong hash so the build reports the
  # real one. .github/workflows/nix-hashes.yml builds these on every supported
  # platform and writes the reported hashes into hashes.json.
  nodeDepsUpdater = mkNodeDeps {
    pname = "arnotes-node-deps-updater";
    version = "0.1.0";
    frozen = true;
    src = pkgs.lib.fileset.toSource {
      root = ../.;
      fileset = pkgs.lib.fileset.unions [
        ../package.json
        ../bun.lock
      ];
    };
    hash = pkgs.lib.fakeHash;
  };

  schemaDepsUpdater = mkNodeDeps {
    pname = "arnotes-schema-node-deps-updater";
    version = "0.1.0";
    src = pkgs.runCommand "arnotes-schema-manifest" { } ''
      mkdir -p "$out"
      cp ${builtins.toFile "package.json" (builtins.toJSON {
        name = "arnotes-schema";
        private = true;
        dependencies = {
          "drizzle-kit" = "0.31.10";
          "drizzle-orm" = "0.45.2";
          postgres = "3.4.9";
        };
      })} "$out/package.json"
    '';
    hash = pkgs.lib.fakeHash;
  };
}
{
  description = "Arnotes - a self-hosted, tag-based note-taking application";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      # Intel macOS (x86_64-darwin) was retired from nixpkgs in 2026 and is not
      # buildable there; Apple Silicon (aarch64-darwin) is supported.
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];

      forAllSystems = nixpkgs.lib.genAttrs systems;

      nixpkgsFor = system: import nixpkgs { inherit system; };

      pkgsFor = system: import ./nix/packages.nix { pkgs = nixpkgsFor system; inherit system; };
    in
    {
      packages = forAllSystems (system: let
        pkgs = pkgsFor system;
      in {
        default = pkgs.arnotes;
        schema = pkgs.schema;
        node-deps = pkgs.nodeDeps;
        node-deps-updater = pkgs.nodeDepsUpdater;
        schema-deps-updater = pkgs.schemaDepsUpdater;
      });

      devShells = forAllSystems (system: {
        default = import ./nix/devshell.nix { pkgs = nixpkgsFor system; };
      });

      nixosModules = {
        default = import ./nix/module.nix;
        arnotes = import ./nix/module.nix;
      };
    };
}
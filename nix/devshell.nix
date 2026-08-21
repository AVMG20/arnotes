{
  pkgs,
}:
let
  inherit (pkgs) bun nodejs postgresql_16;
  pg = "${postgresql_16}/bin";
  dataDir = "$PWD/.nix-data";

  db-start = pkgs.writeShellScriptBin "db-start" ''
    set -euo pipefail
    root="${dataDir}"
    pgdata="$root/pgdata"
    socket="$root/socket"
    port="''${POSTGRES_PORT:-5432}"
    mkdir -p "$root" "$socket"
    if [ ! -f "$pgdata/PG_VERSION" ]; then
      ${pg}/initdb -D "$pgdata" -U arnotes --auth=trust >/dev/null
    fi
    if ! ${pg}/pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
      ${pg}/pg_ctl -D "$pgdata" -l "$root/postgres.log" -o "-p $port -k $socket -c listen_addresses=localhost" start >/dev/null
    fi
    if ! ${pg}/psql -h "$socket" -p "$port" -U arnotes -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='arnotes'" | grep -q 1; then
      ${pg}/createdb -h "$socket" -p "$port" -U arnotes arnotes
    fi
    echo "PostgreSQL ready on 127.0.0.1:$port (DATABASE_URL=postgresql://arnotes:arnotes@localhost:$port/arnotes)"
  '';

  db-stop = pkgs.writeShellScriptBin "db-stop" ''
    set -euo pipefail
    pgdata="${dataDir}/pgdata"
    if [ -f "$pgdata/PG_VERSION" ]; then
      ${pg}/pg_ctl -D "$pgdata" stop -m fast >/dev/null 2>&1 || true
    fi
    echo "PostgreSQL stopped"
  '';
in
pkgs.mkShell {
  packages = [
    bun
    nodejs
    postgresql_16
    db-start
    db-stop
  ];

  shellHook = ''
    echo "Arnotes development shell"
    echo "  db-start            start a local PostgreSQL on port 5432"
    echo "  db-stop             stop it again"
    echo "  bun install         install dependencies"
    echo "  bun run db:push     push the schema to PostgreSQL"
    echo "  bun run dev         run the dev server with hot reload"
  '';
}
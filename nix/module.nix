{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.arnotes;

  arnotes = cfg.package;
  schemaPkg = cfg.schemaPackage;

  boolToStr = b: if b then "true" else "false";

  databaseUrl =
    if cfg.database.url != null then
      cfg.database.url
    else
      "postgresql://${cfg.database.user}:${cfg.database.password}@${cfg.database.host}:${toString cfg.database.port}/${cfg.database.name}";

  # Mirrors the Docker entrypoint: generate a 64-hex-char secret into the state
  # directory on first start, and surface it through an EnvironmentFile.
  secretScript = pkgs.writeShellScript "arnotes-secret" ''
    set -euo pipefail
    state_dir="$1"
    secret_file="$state_dir/data/.auth-secret"
    env_file="$state_dir/env"
    umask 077
    if [ ! -s "$secret_file" ]; then
      ${pkgs.openssl}/bin/openssl rand -hex 32 > "$secret_file"
    fi
    printf 'BETTER_AUTH_SECRET=%s\n' "$(tr -d '\n' < "$secret_file")" > "$env_file"
  '';

  appEnvironment = {
    DATABASE_URL = databaseUrl;
    BETTER_AUTH_URL = cfg.betterAuth.url;
    ALLOW_SIGN_UP = boolToStr cfg.allowSignUp;
    NUXT_PUBLIC_ALLOW_SIGN_UP = boolToStr cfg.allowSignUp;
    NUXT_PUBLIC_DISCORD_ENABLED = boolToStr cfg.discord.enable;
    NUXT_PUBLIC_GITHUB_ENABLED = boolToStr cfg.github.enable;
    DISCORD_CLIENT_ID = cfg.discord.clientId;
    DISCORD_CLIENT_SECRET = cfg.discord.clientSecret;
    GITHUB_CLIENT_ID = cfg.github.clientId;
    GITHUB_CLIENT_SECRET = cfg.github.clientSecret;
    HOST = cfg.host;
    PORT = toString cfg.port;
    HOME = cfg.stateDir;
  }
  // cfg.environment
  // lib.optionalAttrs (cfg.betterAuth.secretFile != null) {
    BETTER_AUTH_SECRET = lib.trim (lib.readFile cfg.betterAuth.secretFile);
  };
in
{
  options.services.arnotes = {
    enable = lib.mkEnableOption "Arnotes";

    package = lib.mkOption {
      type = lib.types.package;
      default = (import ./packages.nix {
        inherit pkgs;
        inherit (pkgs.stdenv.hostPlatform) system;
      }).arnotes;
      defaultText = lib.literalExpression "arnotes packages.arnotes";
      description = "The Arnotes server package to run.";
    };

    schemaPackage = lib.mkOption {
      type = lib.types.package;
      default = (import ./packages.nix {
        inherit pkgs;
        inherit (pkgs.stdenv.hostPlatform) system;
      }).schema;
      defaultText = lib.literalExpression "arnotes packages.schema";
      description = "Package providing the arnotes-db-push schema tool.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "0.0.0.0";
      description = "Address the Arnotes server binds to.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Port the Arnotes server listens on.";
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/arnotes";
      description = "State directory holding attachments and the generated auth secret.";
    };

    database = {
      createLocally = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Create and manage a local PostgreSQL database and role.";
      };
      url = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Full connection URL for an external database; overrides the other database options.";
      };
      user = lib.mkOption {
        type = lib.types.str;
        default = "arnotes";
      };
      password = lib.mkOption {
        type = lib.types.str;
        default = "arnotes";
        description = "Password used in the generated connection URL. Local trust auth does not check it.";
      };
      name = lib.mkOption {
        type = lib.types.str;
        default = "arnotes";
      };
      host = lib.mkOption {
        type = lib.types.str;
        default = "localhost";
      };
      port = lib.mkOption {
        type = lib.types.port;
        default = 5432;
      };
    };

    betterAuth = {
      url = lib.mkOption {
        type = lib.types.str;
        default = "http://localhost:3000";
        description = "Public application origin used by authentication.";
      };
      secretFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "File containing a stable 32+ character secret. When null, one is generated into the state dir on first start.";
      };
    };

    allowSignUp = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether visitors may create email/password accounts.";
    };

    discord = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
      };
      clientId = lib.mkOption {
        type = lib.types.str;
        default = "";
      };
      clientSecret = lib.mkOption {
        type = lib.types.str;
        default = "";
      };
    };

    github = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
      };
      clientId = lib.mkOption {
        type = lib.types.str;
        default = "";
      };
      clientSecret = lib.mkOption {
        type = lib.types.str;
        default = "";
      };
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Extra environment variables passed to the Arnotes service.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the app port in the firewall.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.postgresql = lib.mkIf cfg.database.createLocally {
      enable = true;
      ensureDatabases = [ cfg.database.name ];
      # The local socket and loopback connections use trust auth, so no
      # password is needed; it is only present in the connection URL.
      ensureUsers = [
        {
          name = cfg.database.user;
          ensureDBOwnership = true;
        }
      ];
    };

    users.users.arnotes = {
      isSystemUser = true;
      group = "arnotes";
    };
    users.groups.arnotes = { };

    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 0750 arnotes arnotes -"
      "d ${cfg.stateDir}/data 0750 arnotes arnotes -"
    ];

    systemd.services.arnotes-secret = {
      description = "Arnotes auth secret generation";
      before = [ "arnotes.service" ];
      wantedBy = [ "arnotes.service" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
      script = ''
        mkdir -p "${cfg.stateDir}/data"
        ${secretScript} "${cfg.stateDir}"
      '';
    };

    systemd.services.arnotes-db-setup = {
      description = "Arnotes database schema push";
      after = [
        "postgresql.service"
        "arnotes-secret.service"
      ];
      requires = [ "postgresql.service" ];
      before = [ "arnotes.service" ];
      wantedBy = [ "arnotes.service" ];
      serviceConfig = {
        Type = "oneshot";
        User = "arnotes";
        Group = "arnotes";
      };
      environment = {
        DATABASE_URL = databaseUrl;
        HOME = cfg.stateDir;
      };
      script = ''
        exec ${schemaPkg}/bin/arnotes-db-push
      '';
    };

    systemd.services.arnotes = {
      description = "Arnotes";
      after = [
        "arnotes-db-setup.service"
        "arnotes-secret.service"
        "postgresql.service"
        "network.target"
      ];
      requires = [
        "arnotes-db-setup.service"
        "arnotes-secret.service"
      ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        ExecStart = "${arnotes}/bin/arnotes";
        User = "arnotes";
        Group = "arnotes";
        WorkingDirectory = cfg.stateDir;
        Restart = "on-failure";
        RestartSec = "3s";
        PrivateTmp = true;
        NoNewPrivileges = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        ReadWritePaths = cfg.stateDir;
      };
      environment = appEnvironment;
      serviceConfig.EnvironmentFile = lib.mkIf (cfg.betterAuth.secretFile == null) "-${cfg.stateDir}/env";
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
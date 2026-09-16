{
  description = "postmock dev shell: Node for the server, SDK toolchains for conformance runs (docs/11 B4)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        # The server gates only (`pnpm check`, tools/pack-smoke.sh): a small download for CI.
        node = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
            openssl
          ];
        };
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
            dotnet-sdk_8
            php83
            php83Packages.composer
            jdk17
            maven
            ruby_3_3
            python312
            poetry
            openssl
          ];
        };
      });
    };
}

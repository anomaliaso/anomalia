# Distribute the Anomalia CLI (npm + Homebrew)

## Install channels

| Channel | Command |
|---------|---------|
| **npm** | `npm install -g anomalia-cli` |
| **Homebrew** | `brew tap anomaliaso/tap https://github.com/anomaliaso/homebrew-tap && brew install anomalia` (tap repo created once, see below) |
| **curl** | `curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh \| bash` |
| **From source** | `bun install && bun run cli.ts` |

## npm

The publishable package is built into `dist-npm/` (Node-targeted bundles, no Bun required at runtime):

```bash
bun run build:npm
cd dist-npm && npm publish --access public
```

CI does this on every `v*` tag when the `NPM_TOKEN` repository secret is set
(npm Access Token with publish rights for `anomalia-cli`).

One-time npm setup:

1. Create the package scope/name on [npmjs.com](https://www.npmjs.com) if needed (`anomalia-cli`).
2. Create a granular access token (read/write for `anomalia-cli`) or classic automation token.
3. Add it as GitHub Actions secret `NPM_TOKEN` on this repo.
4. Push a tag: `git tag cli-v0.1.0 && git push origin cli-v0.1.0`.

Optional: configure [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) for
`anomaliaso/anomalia` → workflow `cli-release.yml` and drop the token later.

## Homebrew

Formula: [`Formula/anomalia.rb`](../Formula/anomalia.rb). A Homebrew tap must be its own
repository, so the formula is published to [`anomaliaso/homebrew-tap`](https://github.com/anomaliaso/homebrew-tap)
(create it once by copying the formula from this repo):

```bash
brew tap anomaliaso/tap https://github.com/anomaliaso/homebrew-tap
brew install anomalia
anomalia --version
```

On each `cli-v*` release, CI on `anomaliaso/anomalia`:

1. Builds `anomalia-<platform>` binaries and `.tar.gz` archives
2. Attaches them to the GitHub Release (raw binaries keep `install.sh` working)
3. Rewrites formula `version` + `sha256` via `scripts/update-homebrew-formula.sh`
4. Commits the formula bump to `main` here; pushes it to the tap when the `TAP_TOKEN`
   secret is set

Users update with:

```bash
brew update && brew upgrade anomalia
```

## Local smoke checks

```bash
bun test
bun run build:npm
node dist-npm/cli.js --help
node dist-npm/cli.js --version
```

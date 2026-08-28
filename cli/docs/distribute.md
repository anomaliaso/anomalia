# Distribute the Anomalia CLI (npm + Homebrew)

## Install channels

| Channel | Command |
|---------|---------|
| **npm** | `npm install -g anomalia-cli` |
| **Homebrew** | `brew tap andreabuttarelli/anomalia-cli https://github.com/andreabuttarelli/anomalia-cli && brew install anomalia` |
| **curl** | `curl -sSL https://raw.githubusercontent.com/andreabuttarelli/anomalia-cli/main/scripts/install.sh \| bash` |
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
4. Push a tag: `git tag v0.1.0 && git push origin v0.1.0`.

Optional: configure [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) for
`andreabuttarelli/anomalia-cli` → workflow `release.yml` and drop the token later.

## Homebrew

Formula: [`Formula/anomalia.rb`](../Formula/anomalia.rb) (same-repo tap).

```bash
brew tap andreabuttarelli/anomalia-cli https://github.com/andreabuttarelli/anomalia-cli
brew install anomalia
anomalia --version
```

On each `v*` release, CI:

1. Builds `anomalia-<platform>` binaries and `.tar.gz` archives
2. Attaches them to the GitHub Release (raw binaries keep `install.sh` working)
3. Rewrites formula `version` + `sha256` via `scripts/update-homebrew-formula.sh`
4. Commits the formula bump to `main`

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

# Contributing

[`AGENTS.md`](AGENTS.md) is the working guide for humans and AI agents alike: the map, the commands, the Definition of done and the rules not to break. The reference is in [`docs/`](docs/architecture.md).

`main` holds released code and is the default branch; `develop` is the integration branch. Both take changes only through a pull request with CI green, and repository rulesets block direct pushes, force pushes, and deletion. Dependabot opens its pull requests against `develop`.

1. Branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Make the change with its tests, and run the Definition of done locally.
3. Open a pull request into `develop`, titled in [Conventional Commits](https://www.conventionalcommits.org/) form. It's squash-merged once CI is green.

Releases are pull requests from `develop` (or a `release/vX.Y.Z` branch when `main` has diverged) into `main` titled `release: vX.Y.Z` and merged with a merge commit; `.github/workflows/release.yml` then tags that commit and publishes the GitHub release, and refuses a version that isn't newer than the latest release. Only a pull request whose head is `develop` (or `release/vX.Y.Z` when `main` has diverged) is tagged; any other branch is skipped. Drafts and prereleases don't count as the latest release, and a `release:` title without a version makes neither tag nor release. `Plugin::VERSION`, the header's `Version:` and `plugin/moving-quote/composer.json` are the plugin's own version. They move with each user-visible plugin release, and always when the script or stylesheet changes, so browsers refetch them; they're independent of the repository's `vX.Y.Z` release tags. Report security issues privately, as [`SECURITY.md`](SECURITY.md) describes.

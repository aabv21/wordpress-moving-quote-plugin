# Contributing

[`AGENTS.md`](AGENTS.md) is the working guide for humans and AI agents alike: the repo map, the commands, the conventions, and the Definition of done.

1. Branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Make the change with its tests, and run the Definition of done locally.
3. Open a pull request into `develop`, titled in [Conventional Commits](https://www.conventionalcommits.org/) form. It's squash-merged once CI is green.

Releases are pull requests from `develop` into `main` titled `release: vX.Y.Z` and merged with a merge commit; `.github/workflows/release.yml` then tags that commit and publishes the GitHub release. `Plugin::VERSION`, the header's `Version:` and `plugin/moving-quote/composer.json` are the plugin's own version. They move with each user-visible plugin release, and always when the script or stylesheet changes, so browsers refetch them; they're independent of the repository's `vX.Y.Z` release tags. Report security issues privately, as [`SECURITY.md`](SECURITY.md) describes.

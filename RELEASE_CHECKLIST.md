# Release Checklist

- Run `mise exec -- npm run release:gate` so the repository-local Node toolchain is used.
- Confirm `npm pack --dry-run --json` output.
- Confirm no generated output, local paths or tarballs are committed.
- Confirm dependency and license review is up to date.

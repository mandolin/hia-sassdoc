# Release Checklist

- Run `npm run release:gate`.
- Confirm `npm pack --dry-run --json` output.
- Confirm no generated output, local paths or tarballs are committed.
- Confirm dependency and license review is up to date.

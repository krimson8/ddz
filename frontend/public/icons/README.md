# App PWA Icons (merged 鬥地主 + 五子棋 app)

These icons were generated from `icon.png` via `npx pwa-asset-generator`.
The `public/` folder is the web root, so files here serve at URLs like
`/icons/manifest-icon-192.maskable.png`.

## Files in use

| File                              | Size      | Used by                              | Wired in                |
| --------------------------------- | --------- | ------------------------------------ | ----------------------- |
| `manifest-icon-192.maskable.png`  | 192 x 192 | Android / Chrome (any + maskable)    | `public/manifest.json`  |
| `manifest-icon-512.maskable.png`  | 512 x 512 | Android / Chrome (any + maskable)    | `public/manifest.json`  |
| `apple-icon-180.png`              | 180 x 180 | iOS Safari home-screen (apple-touch) | `src/app/layout.tsx`    |

`icon.png` is the leftover source image used to generate the above — it is not
referenced anywhere and can be deleted.

## Regenerating

From `frontend/public/icons/`:

```bash
npx pwa-asset-generator icon.png ./
```

This also emits ~40 `apple-splash-*.jpg` iOS launch screens, which were deleted
as they are optional and not wired up. Pass `--padding "0"` if you want the
icon artwork full-bleed instead of inset with a maskable safe zone.

## Notes
- **Maskable icons** keep artwork in the center ~80% (Android crops edges into a
  circle/squircle). They double as the regular `any`-purpose icon here.
- **iOS icon (`apple-icon-180.png`):** iOS adds its own rounded mask, so the
  source should be a solid square with no transparency/rounded corners.

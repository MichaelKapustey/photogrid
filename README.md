# PhotoGrid

Lay photos out on A4 pages and download a print-ready PDF. Everything runs in the browser; photos are never uploaded.

- Portrait photos go three to a row, so nine fill a page at 100%. Landscape photos get the same size turned sideways, and other shapes fit inside that size.
- The − / + buttons scale every photo in 10% steps, from 20% to 300%.
- Portrait photos are placed before landscape ones so rows stay even.
- JPEGs go into the PDF byte for byte: no re-compression and no downsizing. EXIF orientation is applied in the PDF, colour profiles are kept, and metadata such as GPS location is left out.
- PNG, WebP and HEIC photos are converted to JPEG at 95% quality and full resolution first. HEIC files the browser can't open are decoded with [heic-to](https://github.com/hoppergee/heic-to), which loads only when needed.

## Run locally

Serve the folder with any static server, for example `python3 -m http.server`, then open http://localhost:8000.

## Tests

`npm test` runs the unit tests with Node 20 or newer. There are no dependencies to install.

## Deploy

GitHub Pages: Settings → Pages → Deploy from a branch → `main`, `/ (root)`.

## Licences

- Barlow fonts: SIL Open Font License, see `fonts/OFL.txt`.
- heic-to (includes libheif and libde265): LGPL-3.0, see `vendor/heic-to/LICENSE`.

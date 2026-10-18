# PhotoGrid

Lay photos out on A4 pages and download a print-ready PDF. Everything runs in the browser; photos are never uploaded.

- Portrait photos go three to a row, so nine fill a page at 100%. Landscape photos get the same size turned sideways, and other shapes fit inside that size.
- The − / + buttons scale every photo in 10% steps, from 20% to 300%.
- Portrait photos are placed before landscape ones so rows stay even.
- With Color boost off, JPEGs go into the PDF byte for byte: no re-compression and no downsizing. EXIF orientation is applied in the PDF, color profiles are kept, and metadata such as GPS location is left out.
- PNG, WebP and HEIC photos are converted to JPEG at 95% quality and full resolution first. HEIC files the browser can't open are decoded with [heic-to](https://github.com/hoppergee/heic-to), which loads only when needed.

## Color boost

Prints on plain paper come out darker and duller than the screen, because the paper soaks up ink and holds fewer colors. Color boost makes up for that, from 0 (off) to 100 (strongest):

- A tone curve lifts mid-tones the most (128 becomes 159 at 100) while black and white stay where they are, so nothing burns out or turns gray.
- Muted colors get more saturation than vivid ones, skin tones get half as much, and no color is pushed past the edge of what the file can hold, so bright areas keep their detail.

Above 0, each photo is decoded, adjusted and saved again as a full-resolution JPEG at 95% quality. This starts in the background once the slider stops moving, and Download PDF unlocks when it's done. Photos larger than 16.7 megapixels, the most an iPhone browser can process at once, are handled in overlapping strips, so they are never downsized either. The preview uses the same adjustment, and the setting is remembered in the browser.

## Run locally

Serve the folder with any static server, for example `python3 -m http.server`, then open http://localhost:8000.

## Tests

`npm test` runs the unit tests with Node 20 or newer. There are no dependencies to install.

## Deploy

GitHub Pages: Settings → Pages → Deploy from a branch → `main`, `/ (root)`.

## Licenses

- Barlow fonts: SIL Open Font License, see `fonts/OFL.txt`.
- heic-to (includes libheif and libde265): LGPL-3.0, see `vendor/heic-to/LICENSE`.

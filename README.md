# SeeYou.Earth

SeeYou.Earth is an open-source project to make astronomical observations easier to explore.

## Project status

- Implemented: an Astro homepage and a SolidJS Sky Explorer form with decimal-degree coordinate validation.
- Implemented: three aligned SPHEREx observation previews, an observation timeline, and ICRS pixel coordinates.
- Planned: observation retrieval by coordinates.

## Local development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Astro.

## Validation

```sh
npm run format:check
npm run check
npm run build
npm run preview
```

The production build is written to `dist/`.

## M101 observation preview

The viewer displays SPHEREx DR1 Level 2 cutouts from NASA/IPAC IRSA. The coordinate form validates a separate requested region. Coordinate-based image retrieval is planned. The table describes the reference observation.

| Field              | Value                                   |
| ------------------ | --------------------------------------- |
| Observation        | `2025W21_2C_0401_3D2`, detector 2       |
| Observation time   | 2025-05-24T21:56:50.949 UTC             |
| Processing version | `l2b-v27-2026-199`                      |
| Requested cutout   | RA 210.80227°, Dec 54.34895°, size 0.1° |
| FITS science image | `IMAGE`, 59 × 59 pixels, MJy/sr         |
| Retrieval date     | 2026-11-19 UTC                          |
| FITS size          | 4,000,320 bytes                         |

To reproduce the previews, download the three original cutouts and run the renderer with Python 3.14:

```sh
mkdir -p data/raw/spherex
node --input-type=module -e 'import entries from "./src/observations.json" with { type: "json" }; for (const { name, source } of entries) console.log(name, source)' |
while read -r name source; do
  curl --fail --location --retry 2 "$source" --output "data/raw/spherex/$name.fits" || exit 1
done
python -m pip install astropy==8.0.3 numpy==2.5.5 pillow==13.0.0
python scripts/render_observation.py
```

The reference FITS SHA-256 is `7e6459d988dfedff4eea7119b5f659b32cf43e20287d99f00cb3281ddf2253ef`.

The PNG is a display product. The renderer clips finite pixels to the 1st–99.5th percentile interval, applies an inverse hyperbolic sine stretch, and uses the reference grid with FITS rows in reverse display order. It does not apply the quality flags or reproject to north-up. Use the FITS file for scientific measurements.

## Observation timeline and WCS

The viewer includes three M101 observations. The renderer verifies the checksums of all three source FITS files.

All three images use the first observation's celestial WCS as a common display
grid. For each output pixel, Astropy transforms the pixel center to ICRS and
then into the input image. Nearest-neighbor sampling preserves input samples
for display, with black used outside the footprint. The renderer verifies the
WCS round trip and the reference center against the IRSA request. Cursor
coordinates refer to output pixel centers. They do not represent an estimate
of the telescope's absolute astrometric accuracy.

The wavelength shown is the approximate central wavelength at the requested
sky position from the FITS spectral WCS. The three bands are disjoint at that
position, so time and wavelength both change between frames. The timeline is
a visual comparison, and the aligned previews must not be used for calibrated
image subtraction.

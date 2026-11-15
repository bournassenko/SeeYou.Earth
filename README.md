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

## Experimental source detection

Install `photutils==3.1.1` and `scipy==1.18.1` in the same environment as the renderer and run `python scripts/detect_sources.py` after downloading the original FITS files. The results are linked to the observation selected in the viewer.

The detector works in native FITS pixels. It subtracts the modeled zodiacal foreground, excludes all flagged pixels except pixels carrying only the archive's SOURCE bit, masks invalid variances, estimates a sigma-clipped background, and runs DAOFIND with the exposure PSF width from the FITS header. The reported peak SNR divides the background-subtracted peak by the larger of the measured background scatter or the pixel uncertainty. This is a screening statistic. Crowded or extended regions can create false positives, and a detection alone provides no evidence of motion or variability.

## Experimental Gaia DR3 cross-match

Run `python scripts/match_gaia.py` after source detection. It queries the ESA Gaia Archive for an ICRS cone around M101 and lists every nearby entry within a 3 arcsecond screening radius plus a conservative Gaia positional-error margin. Where available, proper motions shift the Gaia coordinates to the SPHEREx exposure epoch. Without a measured proper motion the interface labels the entry as a reference-epoch position. This positional search ignores parallax and radial motion, does not resolve blends, and covers only the queried Gaia cone. A nearby entry is a possible association, and an empty result provides no evidence of a discovery.

## Linux desktop build

Install the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for Debian or Ubuntu, including Rust and WebKitGTK. Then run:

```sh
npm ci
npm run desktop:build
```

The Debian package is written to `src-tauri/target/release/bundle/deb/`.
The desktop app packages the same static observation viewer and bundled data
as the web build. If WebKitGTK opens a blank window in a virtual display,
launch with `WEBKIT_DISABLE_DMABUF_RENDERER=1` to use the fallback renderer.

## Experimental ZTF difference

This example uses two ZTF r-band science exposures from the same field, CCD and
quadrant, and their associated quality maps. It is a separate dataset from
the SPHEREx timeline. Download the science and mask FITS files from IRSA and generate the
preview with the same Python dependencies as source detection.

```sh
mkdir -p data/raw/ztf
for exposure in 20180408381620 20180411423368 20180411467847; do
  year=$(printf '%s' "$exposure" | cut -c1-4)
  month_day=$(printf '%s' "$exposure" | cut -c5-8)
  fraction=$(printf '%s' "$exposure" | cut -c9-14)
  for product in sciimg mskimg; do
    base="https://irsa.ipac.caltech.edu/ibe/data/ztf/products/sci/$year/$month_day/$fraction"
    name="ztf_${exposure}_000535_zr_c11_o_q3_${product}.fits"
    curl --fail --location --retry 2 "$base/$name?center=255.57691,12.28378&size=50arcsec&gzip=false" \
      --output "data/raw/ztf/$exposure-$product.fits" || exit 1
  done
done
python scripts/compare_ztf.py
```

The comparison masks flagged pixels, removes a sigma-clipped background,
normalizes the exposure zeropoints, approximates PSF matching by Gaussian
smoothing to the poorer seeing, and reprojects the earlier frame onto the
later WCS with bilinear interpolation. It then subtracts earlier from later.
The noise diagnostic uses the background RMS and shot noise estimated from the
gain, with a conservative upper-bound treatment of correlations from resampling
within each exposure. It does not account for zeropoint or PSF-model uncertainty.
The PNG clips residuals at symmetric 99th-percentile limits and leaves invalid
pixels transparent. The residual can include calibration and PSF mismatch and
is not a detection significance map.

## Experimental motion screening

Run `python scripts/track_ztf.py` after fetching the ZTF cutouts. The third
exposure adds an independent epoch. The script detects point-like peaks in
native pixels, maps their centroids to a shared tangent plane, and evaluates
each three-epoch association against stationary and constant-velocity fits.
The approximate uncertainty combines a seeing/SNR centroid estimate and the
header astrometry RMS. Candidate hypotheses must improve χ² by at least 25
and have a reduced χ² of at most 3. The list is ordered by the χ² improvement,
which is a screening statistic rather than a probability. Coincidences and
unmodeled astrometric errors can produce false associations.

The bundled ZTF cutouts do not yield candidate tracks at the configured
threshold. The synthetic trajectory test verifies the fitting logic with a
known velocity and rejects stationary, inconsistent and missing observations.
Positive recovery on a real moving object remains unverified.

## Live observation search

Run `npm run api` and `npm run dev` in separate terminals. Astro forwards
`/api` requests to the local Node service on port 4323. Production can serve
`dist/` with any HTTPS web server that proxies `/api/` to the loopback service.
The search returns up to five SPHEREx DR1 science products whose footprints
intersect the requested ICRS circle. Field of view is the circle diameter.
Results link to the original FITS files. The desktop viewer uses bundled
observations when running locally.

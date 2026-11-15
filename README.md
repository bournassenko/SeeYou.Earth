# SeeYou.Earth

SeeYou.Earth is an open-source project to make astronomical observations easier to explore.

## Project status

- Implemented: an Astro homepage and a SolidJS Sky Explorer form with decimal-degree coordinate validation.
- Implemented: three aligned SPHEREx observation previews, an observation timeline, and ICRS pixel coordinates.
- Implemented: live IRSA metadata search by coordinates, with links to the original FITS files.
- Planned: rendering observations returned by a search.

## Local development

Use Node.js 24 and npm.

```sh
npm ci
npm run api
```

Run `npm run dev` in another terminal and open the local URL printed by Astro.

## Validation

```sh
npm run format:check
npm run check
npm run build
npm run preview
```

The production build is written to `dist/`.

## M101 observation preview

The viewer displays SPHEREx DR1 Level 2 cutouts from NASA/IPAC IRSA. The coordinate form searches IRSA and links to the original FITS files. The M101 viewer displays bundled previews. The table describes the reference observation.

| Field              | Value                                   |
| ------------------ | --------------------------------------- |
| Observation        | `2025W21_2C_0401_3D2`, detector 2       |
| Observation time   | 2025-05-24T21:56:50.949 UTC             |
| Processing version | `l2b-v27-2026-199`                      |
| Requested cutout   | RA 210.80227°, Dec 54.34895°, size 0.1° |
| FITS science image | `IMAGE`, 59 × 59 pixels, MJy/sr         |
| FITS size          | 4,000,320 bytes                         |

To reproduce the previews, download the three original cutouts and run the renderer with Python 3.14:

```sh
mkdir -p data/raw/spherex
node --input-type=module -e 'import entries from "./src/observations.json" with { type: "json" }; for (const { name, source } of entries) console.log(name, source)' |
while read -r name source; do
  destination="data/raw/spherex/$name.fits"
  test -e "$destination" && continue
  curl --fail --location --retry 2 "$source" --output "$destination.part" || exit 1
  mv -n "$destination.part" "$destination"
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

Run `python scripts/match_gaia.py` after source detection. The viewer links the catalog results to the exact measured centroid in each observation and reports unavailable matches for centroids absent from the catalog output. It queries the ESA Gaia Archive for an ICRS cone around M101 and lists every nearby entry within a 3 arcsecond screening radius plus a conservative Gaia positional-error margin. Where available, proper motions shift the Gaia coordinates to the SPHEREx exposure epoch. Without a measured proper motion the interface labels the entry as a reference-epoch position. This positional search ignores parallax and radial motion, does not resolve blends, and covers only the queried Gaia cone. A nearby entry is a possible association, and an empty result provides no evidence of a discovery.

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
    destination="data/raw/ztf/$exposure-$product.fits"
    test -e "$destination" && continue
    curl --fail --location --retry 2 "$base/$name?center=255.57691,12.28378&size=50arcsec&gzip=false" \
      --output "$destination.part" || exit 1
    mv -n "$destination.part" "$destination"
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

## EC2 preview

`deploy/ec2-bootstrap.sh` boots the application on an Ubuntu 24.04 x86-64
instance. Substitute `APP_REVISION_PLACEHOLDER` with the full, published
Git commit before passing the script as EC2 user data. It builds the site,
serves the static assets with nginx, and runs the archive API on loopback via
systemd. The public preview exposes HTTP on port 80. The instance requires
outbound access to GitHub, Ubuntu, Node.js and npm during bootstrap, and to the
IRSA archive during search. The active build is reported at `/version.txt`;
the API responds at `/api/health`.

The UI uses the shadcn Nova neutral tokens and Inter typography from preset
`b0` with native HTML and SolidJS. Source reports export the observation,
coordinate frame, spectral metadata and nearby catalog entries for review.

The SPHEREx viewer can overlay detections on the aligned reference grid. Click
a marker or its source number in the table to inspect the measured position,
peak SNR and count of nearby Gaia entries. The detector projects centroids into
the display grid using the reference WCS and leaves off-frame centroids
unmarked. Swipe comparison uses the same grid and shows both wavelengths
alongside the observation dates.

The image can be zoomed to 2× or 4× and panned by scrolling. Pin a pixel to
keep its ICRS coordinates and marker across aligned exposures. With the image
focused, the arrow keys move the inspection point and Enter toggles the pin.
Zoom changes only the view scale.

The difference panel shows the two processed exposures and their residual on
the same grid and with the same valid-pixel mask. Both exposure previews use
a shared display stretch. The residual uses its own symmetric scale.

Pin an image position to inspect the archived pixel brightness and its
pipeline uncertainty across the three observations. Each point samples the
nearest native detector pixel on the aligned grid and omits flagged or
uncovered pixels. The wavelength is an approximate display value from the
spectral lookup table. Brightness includes the modeled zodiacal contribution
present in the archive data; the spread across different dates and
wavelengths is not a temporal light curve.

## Astrometry review

Open **Review** to import or paste a CSV with the header
`utc,ra_deg,dec_deg,sigma_arcsec`. Supply 3–200 independently timed
centroid measurements within one degree of the first position. Use UTC
exposure midpoints ending in `Z`, ICRS coordinates in decimal degrees, and
one-sigma position uncertainty per axis in arcseconds. Estimates should
include applicable astrometric systematics. The analysis stays in the browser.

The reviewer uses inverse-variance weights in a local gnomonic projection and
reports the chi-square of a fixed position and a constant angular velocity.
It fits a second track excluding the last epoch, then reports that epoch's
predicted position, residual, and combined per-axis uncertainty. The JSON
export records the input measurements, provenance, assumptions and diagnostics.
This local fit does not model parallax, orbit curvature or correlated errors.
Catalog vetting and independent follow-up are separate steps.

**Try archived track** loads four real observations of the known asteroid
2024 YR4 from the [MPC Observations API](https://docs.minorplanetcenter.net/mpc-ops-docs/apis/get-obs/).
They were measured on 2024-12-26 at observatory 703, MPC track
`00000Ib5XP`. The example uses the larger of `rmsra` and `rmsdec` as
the common per-axis uncertainty. Observation identifiers are included in
the report so the sequence can be checked against the archive.

Open `/demo` for a hands-free tour of archive search, source inspection,
swipe comparison, the pinned-pixel spectrum, image subtraction and the
archived astrometry review. The tour uses the same controls and observations
as the explorer and can be paused or replayed.

The demo uses a large animated pointer and a spotlight to follow the active
control. The cursor activates the displayed controls and clicks Next automatically. Both overlays leave the page interactive. Reduced-motion settings
disable the pointer animation and smooth scrolling.

For the existing Ubuntu EC2 deployment, run `deploy/ec2-update.sh` through
Systems Manager with the full published Git revision as its argument. It
builds the release before switching nginx and the local API to it. For the
first HTTPS deployment, the DNS A record for `seeyou.earth` must point at the
instance so Certbot can validate the domain. The script enables certificate
renewal and redirects domain traffic to HTTPS.

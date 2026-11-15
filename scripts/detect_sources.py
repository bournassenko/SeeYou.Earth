import json

import numpy as np
from astropy.io import fits
from astropy.stats import sigma_clipped_stats
from astropy.wcs import WCS
from photutils.detection import DAOStarFinder
from scipy.ndimage import binary_dilation

from render_observation import OBSERVATIONS, RAW, ROOT


SOURCE_FLAG = 1 << 21


def detect(observation):
    hdu = observation["IMAGE"]
    brightness = hdu.data - observation["ZODI"].data
    variance = observation["VARIANCE"].data
    flags = observation["FLAGS"].data.astype(np.uint32)
    mask = (
        ((flags & np.uint32(0xFFFFFFFF ^ SOURCE_FLAG)) != 0)
        | ~np.isfinite(brightness)
        | ~np.isfinite(variance)
        | (variance <= 0)
    )
    if mask.all():
        raise ValueError("No valid pixels for source detection.")

    _, background, scatter = sigma_clipped_stats(brightness, mask=mask)
    if not np.isfinite(scatter) or scatter <= 0:
        raise ValueError("Cannot estimate the background noise.")

    wcs = WCS(hdu.header, fobj=observation).celestial
    pixel_scale = np.sqrt(np.prod([scale.to_value("arcsec") for scale in wcs.proj_plane_pixel_scales()]))
    fwhm = hdu.header["PSF_FWHM"] / pixel_scale
    signal = np.where(mask, 0, brightness - background)
    finder = DAOStarFinder(threshold=5 * scatter, fwhm=fwhm, exclude_border=True)
    sources = finder(signal, mask=binary_dilation(mask, iterations=2))
    if sources is None:
        return []

    results = []
    for source in sources:
        x, y = float(source["x_centroid"]), float(source["y_centroid"])
        column, row = int(round(x)), int(round(y))
        if not (0 <= row < signal.shape[0] and 0 <= column < signal.shape[1]):
            continue
        if mask[row, column]:
            continue
        sky = wcs.pixel_to_world(x, y).icrs
        noise = max(float(scatter), float(np.sqrt(variance[row, column])))
        peak_snr = float(signal[row, column]) / noise
        if peak_snr >= 5:
            results.append({
                "ra": float(sky.ra.deg),
                "dec": float(sky.dec.deg),
                "peakSnr": peak_snr,
            })
    return sorted(results, key=lambda source: source["peakSnr"], reverse=True)


def main():
    results = {}
    for name in OBSERVATIONS:
        with fits.open(RAW / f"{name}.fits") as observation:
            observation.verify("exception")
            results[name] = detect(observation)
    (ROOT / "src/detections.json").write_text(
        json.dumps(results, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

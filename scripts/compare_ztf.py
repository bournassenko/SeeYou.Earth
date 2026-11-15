import hashlib
import json

import numpy as np
from astropy.io import fits
from astropy.stats import sigma_clipped_stats
from astropy.time import Time
from astropy.wcs import WCS
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

from render_observation import ROOT


EXPOSURES = {
    "20180408381620": (
        "6f60d168da2db65ce9bc73f9ded235dfd9c5827f01e9708acab7302066627d02",
        "1ade43e6b3c6563c60dbafa301f5bea53165b4a3e126d6a1db3997c65cc58db5",
    ),
    "20180411467847": (
        "f5ead7e022dc2911563ee130f425ef26c7b83af0b8bb5632483ebceed1fa1b5d",
        "de8f8606bdc01e9fd9ae6828b3171c62e5c824340b95eb4ca1b9ec7bf2433dab",
    ),
}
ZERO_POINT = 25.0


def load(exposure, product, checksum):
    path = ROOT / "data/raw/ztf" / f"{exposure}-{product}.fits"
    if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
        raise ValueError(f"Unexpected FITS checksum for {path.name}.")
    with fits.open(path) as hdus:
        hdus.verify("exception")
        return hdus[0].data.copy(), hdus[0].header.copy()


def prepare(raw, mask, header, target_seeing):
    valid = (mask == 0) & np.isfinite(raw)
    _, background, scatter = sigma_clipped_stats(raw, mask=~valid)
    if not np.isfinite(scatter) or scatter <= 0:
        raise ValueError("Cannot estimate exposure noise.")

    signal = np.where(valid, raw - background, 0)
    noise = np.where(valid, np.sqrt(scatter**2 + np.maximum(signal, 0) / header["GAIN"]), 0)
    scale = 10 ** (0.4 * (ZERO_POINT - header["MAGZP"]))
    pixel_scale = np.sqrt(abs(np.linalg.det(WCS(header).celestial.pixel_scale_matrix))) * 3600
    sigma = np.sqrt(max(0, target_seeing**2 - header["SEEING"]**2)) / (2.35482 * pixel_scale)
    if sigma > 0:
        signal = gaussian_filter(signal, sigma, mode="constant")
        noise = gaussian_filter(noise, sigma, mode="constant")
        valid = gaussian_filter(valid.astype(float), sigma, mode="constant") > 1 - 1e-7
    return signal * scale, noise * scale, valid


def main():
    exposures = []
    for exposure, (image_hash, mask_hash) in EXPOSURES.items():
        raw, header = load(exposure, "sciimg", image_hash)
        mask, mask_header = load(exposure, "mskimg", mask_hash)
        for key in ("OBSJD", "FILTER", "CRPIX1", "CRPIX2"):
            if header[key] != mask_header[key]:
                raise ValueError(f"Science image and quality mask differ in {key}.")
        if raw.shape != mask.shape:
            raise ValueError("Science image and quality mask have different shapes.")
        exposures.append((raw, mask, header))

    earlier, later = exposures
    for key in ("FILTER", "CCD_ID", "QID"):
        if earlier[2][key] != later[2][key]:
            raise ValueError(f"Exposures differ in {key}.")
    target_seeing = max(exposure[2]["SEEING"] for exposure in exposures)
    first, first_noise, first_valid = prepare(*earlier, target_seeing)
    second, second_noise, second_valid = prepare(*later, target_seeing)
    output_wcs = WCS(later[2]).celestial
    y, x = np.indices(second.shape, dtype=float)
    sky = output_wcs.pixel_to_world(x, y)
    first_wcs = WCS(earlier[2]).celestial
    mapped_x, mapped_y = first_wcs.world_to_pixel(sky)
    np.testing.assert_allclose(first_wcs.pixel_to_world(mapped_x, mapped_y).separation(sky).arcsec,
                               0, atol=1e-4, rtol=0)
    positions = [mapped_y, mapped_x]
    first = map_coordinates(first, positions, order=1)
    first_noise = map_coordinates(first_noise, positions, order=1)
    first_valid = map_coordinates(first_valid.astype(float), positions, order=1) > 1 - 1e-7
    valid = first_valid & second_valid
    if not valid.any():
        raise ValueError("The aligned exposures have no valid overlap.")

    residual = second - first
    noise = np.hypot(second_noise, first_noise)
    standardized = residual[valid] / noise[valid]
    if not np.isfinite(standardized).all():
        raise ValueError("Invalid normalized residuals.")

    limit = float(np.percentile(np.abs(residual[valid]), 99))
    if not np.isfinite(limit) or limit <= 0:
        raise ValueError("Cannot establish a symmetric display range.")
    display = np.zeros((*second.shape, 4), dtype=np.uint8)
    display[valid, :3] = np.rint(127.5 * (1 + np.clip(residual[valid] / limit, -1, 1)))[:, None]
    display[valid, 3] = 255
    Image.fromarray(np.flipud(display)).save(ROOT / "public/observations/ztf-r-difference.png")
    summary = {
        "dates": [Time(exposure[2]["OBSJD"], format="jd", scale="utc").isot
                  for exposure in exposures],
        "limit": limit,
        "validPixels": int(valid.sum()),
        "medianNormalizedResidual": float(np.median(standardized)),
        "seeingArcsec": target_seeing,
    }
    (ROOT / "src/ztfDifference.json").write_text(
        json.dumps(summary, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

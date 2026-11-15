import json
from itertools import product

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.stats import sigma_clipped_stats
from astropy.wcs import WCS
from photutils.detection import DAOStarFinder
from scipy.ndimage import binary_dilation

from compare_ztf import EXPOSURES, load
from render_observation import ROOT


EXPOSURES = {
    **EXPOSURES,
    "20180411423368": (
        "3cd91f62d26d46d969c4ef403b40b00ecab937996c6cfdda8c8d00095f7e209e",
        "c7a6e0f16c07082169dfc29bd4e4045a39e9128f7a3251856d06a890c2e092e5",
    ),
}
CENTER = SkyCoord(255.57691, 12.28378, unit="deg")


def detect_exposure(exposure, checksums):
    raw, header = load(exposure, "sciimg", checksums[0])
    flags, flag_header = load(exposure, "mskimg", checksums[1])
    if raw.shape != flags.shape or header["OBSJD"] != flag_header["OBSJD"]:
        raise ValueError("The quality map does not match the exposure.")
    masked = (flags != 0) | ~np.isfinite(raw)
    _, background, noise = sigma_clipped_stats(raw, mask=masked)
    if not np.isfinite(noise) or noise <= 0:
        raise ValueError("Cannot estimate exposure noise.")

    wcs = WCS(header).celestial
    scale = np.sqrt(abs(np.linalg.det(wcs.pixel_scale_matrix))) * 3600
    seeing = header["SEEING"]
    signal = np.where(masked, 0, raw - background)
    finder = DAOStarFinder(5 * noise, seeing / scale, exclude_border=True)
    sources = finder(signal, mask=binary_dilation(masked, iterations=3))
    start = header["OBSJD"]
    middle = start + header["EXPTIME"] / 172800
    if sources is None:
        return middle, []

    astrometric_error = max(header["ASTRRMS1"], header["ASTRRMS2"]) * 3600
    detections = []
    for source in sources:
        x, y = source["x_centroid"], source["y_centroid"]
        peak_snr = float(source["peak"]) / noise
        if peak_snr < 5:
            continue
        sky = wcs.pixel_to_world(x, y).icrs
        east, north = CENTER.spherical_offsets_to(sky)
        centroid_error = seeing / (2.355 * peak_snr)
        uncertainty = np.hypot(centroid_error, astrometric_error)
        detections.append((east.arcsec, north.arcsec, uncertainty))
    return middle, detections


def rank_tracks(frames):
    if len(frames) < 3:
        raise ValueError("Track fitting requires at least three epochs.")
    times = np.array([time for time, _ in frames])
    elapsed = times - times[0]
    if not np.all(np.diff(times) > 0):
        raise ValueError("Track fitting requires distinct sorted epochs.")
    design = np.column_stack((np.ones(len(times)), elapsed))
    candidates = []
    for track in product(*(detections for _, detections in frames)):
        points = np.array(track)
        positions = points[:, :2]
        uncertainty = points[:, 2, None]
        weights = 1 / uncertainty[:, 0] ** 2
        fixed = np.average(positions, axis=0, weights=weights)
        coefficients = np.linalg.lstsq(design / uncertainty, positions / uncertainty,
                                       rcond=None)[0]
        moving_chi2 = np.sum(((positions - design @ coefficients) / uncertainty) ** 2)
        stationary_chi2 = np.sum(((positions - fixed) / uncertainty) ** 2)
        improvement = float(stationary_chi2 - moving_chi2)
        reduced_chi2 = float(moving_chi2 / (2 * len(times) - 4))
        if improvement >= 25 and reduced_chi2 <= 3:
            origin = CENTER.spherical_offsets_by(*(coefficients[0] * u.arcsec))
            candidates.append({
                "ra": float(origin.ra.deg),
                "dec": float(origin.dec.deg),
                "speedArcsecPerDay": float(np.linalg.norm(coefficients[1])),
                "deltaChiSquared": improvement,
                "reducedChiSquared": reduced_chi2,
            })
    return sorted(candidates, key=lambda item: item["deltaChiSquared"], reverse=True)


def main():
    frames = sorted(detect_exposure(exposure, hashes) for exposure, hashes in EXPOSURES.items())
    result = {
        "detectionsPerExposure": [len(detections) for _, detections in frames],
        "candidates": rank_tracks(frames),
    }
    (ROOT / "src/ztfTracks.json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

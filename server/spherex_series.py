import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import redirect_stdout
from datetime import datetime
from hashlib import sha256
from io import BytesIO
import json
import sys
from urllib.parse import urlencode
from urllib.request import urlopen

from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
import numpy as np
from PIL import Image


if __package__:
    from .source_detection import MIN_PEAK_SNR, SOURCE_FLAG, detect_sources
else:
    from source_detection import MIN_PEAK_SNR, SOURCE_FLAG, detect_sources

MAX_REPORTED_SOURCES = 150
MAX_CUTOUT_BYTES = 12 * 1024 * 1024


def sky_grid(ra, dec, fov):
    pixels = min(256, max(12, round(fov * 3600 / 6.15)))
    grid = WCS(naxis=2)
    grid.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    grid.wcs.radesys = "ICRS"
    grid.wcs.crval = [ra, dec]
    grid.wcs.crpix = [(pixels + 1) / 2] * 2
    scale = np.rad2deg(2 * np.tan(np.deg2rad(fov / 2))) / pixels
    grid.wcs.cdelt = [-scale, scale]
    return grid, pixels


def download_cutout(url):
    with urlopen(url, timeout=12) as response:
        content = response.read(MAX_CUTOUT_BYTES + 1)
    if len(content) > MAX_CUTOUT_BYTES:
        raise ValueError("Cutout exceeds the size limit.")
    return content


def detection_summary(hdus, spatial, grid, size):
    try:
        sources = detect_sources(hdus, spatial)
    except (ValueError, KeyError) as error:
        return {"status": "unavailable", "reason": str(error)}
    if not sources:
        return {"status": "complete", "total": 0, "sources": []}

    positions = SkyCoord([s["ra"] for s in sources], [s["dec"] for s in sources], unit="deg")
    columns, rows = grid.world_to_pixel(positions)
    visible = []
    for source, column, row in zip(sources, columns, rows, strict=True):
        x, y = (column + 0.5) / size, (size - row - 0.5) / size
        if 0 <= x < 1 and 0 <= y < 1:
            visible.append({**source, "x": x, "y": y})
    return {
        "status": "complete",
        "total": len(visible),
        "sources": visible[:MAX_REPORTED_SOURCES],
    }


def load_frame(entry, center, sky, grid, size, fov):
    params = urlencode({"center": f"{center.ra.deg},{center.dec.deg}", "size": f"{fov * 1.06:.6f}"})
    url = f"{entry['source']}?{params}"
    content = download_cutout(url)

    with fits.open(BytesIO(content), memmap=False) as hdus:
        image = hdus["IMAGE"]
        spatial = WCS(image.header, fobj=hdus).celestial
        cx, cy = spatial.world_to_pixel(center)
        height, width = image.data.shape
        if not (-0.5 <= cx < width - 0.5 and -0.5 <= cy < height - 0.5):
            return None

        spectral = WCS(image.header, fobj=hdus, key="W")
        spectral.sip = None
        wavelength, bandwidth = spectral.pixel_to_world(cx, cy)
        wave, band = float(wavelength.to_value(u.um)), float(bandwidth.to_value(u.um))
        if not np.isfinite([wave, band]).all() or min(wave, band) <= 0:
            return None

        x, y = spatial.world_to_pixel(sky)
        inside = (x >= -0.5) & (x < width - 0.5) & (y >= -0.5) & (y < height - 0.5)
        nx = np.floor(x[inside] + 0.5).astype(int)
        ny = np.floor(y[inside] + 0.5).astype(int)
        flags = hdus["FLAGS"].data[ny, nx].astype(np.uint32)
        flux = image.data[ny, nx]
        valid = np.isfinite(flux) & ((flags & np.uint32(0xFFFFFFFF ^ SOURCE_FLAG)) == 0)
        aligned = np.full(sky.shape, np.nan, dtype=np.float32)
        aligned[inside] = np.where(valid, flux, np.nan)
        coverage = float(np.isfinite(aligned).mean())
        if coverage < 0.25:
            return None

        return {
            **entry,
            "cutout": url,
            "wavelength": wave,
            "bandwidth": band,
            "coverage": coverage,
            "cutoutSha256": sha256(content).hexdigest(),
            "detection": detection_summary(hdus, spatial, grid, size),
        }, aligned


def band_groups(frames):
    groups = []
    seen = set()
    for anchor, _ in frames:
        center = anchor["wavelength"]
        group = [(meta, image) for meta, image in frames if
                 meta["detector"] == anchor["detector"] and
                 abs(meta["wavelength"] - center) <= min(meta["bandwidth"], anchor["bandwidth"]) / 2]
        key = tuple(meta["source"] for meta, _ in group)
        if len(group) < 2 or key in seen:
            continue
        seen.add(key)
        groups.append(group)
    def span(group):
        first = datetime.fromisoformat(group[0][0]["date"])
        last = datetime.fromisoformat(group[-1][0]["date"])
        return (last - first).total_seconds()

    groups.sort(key=lambda group: (span(group), len(group)), reverse=True)
    return groups


def encode_frames(frames):
    finite = np.concatenate([image[np.isfinite(image)] for _, image in frames])
    low, high = (float(value) for value in np.percentile(finite, [1, 99.5]))
    if high <= low:
        high = low + max(1e-6, abs(low) * 1e-6)
    encoded = []
    for meta, image in frames:
        valid = np.isfinite(image)
        display = np.zeros((*image.shape, 2), dtype=np.uint8)
        scaled = np.clip((image[valid] - low) / (high - low), 0, 1)
        display[valid, 0] = np.rint(np.arcsinh(10 * scaled) / np.arcsinh(10) * 255)
        display[valid, 1] = 255
        output = BytesIO()
        Image.fromarray(display).save(output, format="PNG")
        encoded.append({**meta, "image": base64.b64encode(output.getvalue()).decode("ascii")})
    return {"frames": encoded, "stretch": [low, high]}


def main():
    request = json.load(sys.stdin)
    ra, dec, fov = (request[key] for key in ("ra", "dec", "fov"))
    entries = request["entries"]
    center = SkyCoord(ra, dec, unit="deg", frame="icrs")
    grid, size = sky_grid(ra, dec, fov)
    y, x = np.indices((size, size))
    sky = grid.pixel_to_world(x, size - 1 - y)

    def download(entry):
        try:
            return load_frame(entry, center, sky, grid, size, fov), False
        except (OSError, ValueError, KeyError) as error:
            print(str(error), file=sys.stderr)
            return None, True

    results = []
    usable = 0
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(download, entry) for entry in entries]
        for completed, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            usable += result[0] is not None
            if request.get("reportProgress"):
                print(f"PROGRESS {completed} {usable}", file=sys.stderr, flush=True)
    frames = sorted((frame for frame, _ in results if frame), key=lambda frame: (frame[0]["date"], frame[0]["source"]))
    groups = band_groups(frames)
    selected = {}
    for group in groups:
        selected.setdefault(group[0][0]["detector"], group)
    return {
        "series": [{"comparable": True, **encode_frames(group)} for group in selected.values()],
        "all": {"comparable": False, **encode_frames(frames)} if frames else None,
        "failed": sum(failed for _, failed in results),
        "sampled": len(entries),
        "detectionMethod": {
            "id": "spherex-daofind-v1",
            "minimumPeakSnr": MIN_PEAK_SNR,
            "maxReportedSources": MAX_REPORTED_SOURCES,
        },
    }


if __name__ == "__main__":
    with redirect_stdout(sys.stderr):
        result = main()
    print(json.dumps(result, allow_nan=False))

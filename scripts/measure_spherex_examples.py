from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from time import sleep
from urllib.parse import urlparse

from astropy.io import fits
from astropy.wcs import WCS

from server.spherex_series import (
    MAX_REPORTED_SOURCES,
    MIN_PEAK_SNR,
    detection_summary,
    download_cutout,
    sky_grid,
)


EXAMPLE_DIR = Path(__file__).resolve().parents[1] / "public/observations/examples"


def measure(url, grid, size):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "irsa.ipac.caltech.edu" or not (
        parsed.path.startswith(("/ibe/data/spherex/dr1/level2/", "/ibe/data/spherex/qr3/level2/")) and parsed.path.endswith(".fits")
    ):
        raise ValueError("Unexpected archive URL.")

    for attempt in range(3):
        try:
            content = download_cutout(url)
            with fits.open(BytesIO(content), memmap=False) as hdus:
                spatial = WCS(hdus["IMAGE"].header, fobj=hdus).celestial
                summary = detection_summary(hdus, spatial, grid, size)
            return {"cutoutSha256": sha256(content).hexdigest(), "detection": summary}
        except (OSError, KeyError, ValueError):
            if attempt < 2:
                sleep(attempt + 1)
    return {"detection": {"status": "unavailable", "reason": "FITS cutout could not be measured."}}


def update(path):
    data = json.loads(path.read_text())
    grid, size = sky_grid(data["ra"], data["dec"], data["fov"])
    frames = [frame for group in [data["all"], *data["series"]] for frame in group["frames"]]
    inputs = {frame["cutout"]: frame for frame in frames}
    with ThreadPoolExecutor(max_workers=4) as pool:
        updates = dict(zip(inputs, pool.map(lambda url: measure(url, grid, size), inputs), strict=True))
    for frame in frames:
        frame.pop("cutoutSha256", None)
        frame.update(updates[frame["cutout"]])
    data["detectionMethod"] = {
        "id": "spherex-daofind-v1",
        "minimumPeakSnr": MIN_PEAK_SNR,
        "maxReportedSources": MAX_REPORTED_SOURCES,
    }
    path.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n")
    completed = sum(update["detection"]["status"] == "complete" for update in updates.values())
    count = sum(update["detection"].get("total", 0) for update in updates.values())
    print(f"{path.stem}: {completed}/{len(inputs)} frames measured, {count} detections", file=sys.stderr)


if __name__ == "__main__":
    names = set(sys.argv[1:])
    with redirect_stdout(sys.stderr):
        for path in sorted(EXAMPLE_DIR.glob("*.json")):
            if not names or path.stem in names:
                update(path)

import json
import sys
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS

from render_observation import OBSERVATIONS, REFERENCE, ROOT, verified_source


sys.path.insert(0, str(ROOT))
from server.source_detection import detect_sources


def main():
    with fits.open(verified_source(REFERENCE)) as reference:
        image = reference["IMAGE"]
        height, width = image.data.shape
        display_wcs = WCS(image.header, fobj=reference).celestial

    results = {}
    for name in OBSERVATIONS:
        with fits.open(verified_source(name)) as observation:
            observation.verify("exception")
            sources = detect_sources(observation)
        for source in sources:
            sky = SkyCoord(source["ra"], source["dec"], unit="deg", frame="icrs")
            x, y = display_wcs.world_to_pixel(sky)
            display_x, display_y = float(x) + 0.5, height - 0.5 - float(y)
            source["display"] = (
                {"x": display_x / width, "y": display_y / height}
                if 0 <= display_x < width and 0 <= display_y < height
                else None
            )
        results[name] = sources
    (ROOT / "src/detections.json").write_text(
        json.dumps(results, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

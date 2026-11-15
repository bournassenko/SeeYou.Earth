import csv
import io
import json
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.time import Time

from render_observation import ROOT


ENDPOINT = "https://gea.esac.esa.int/tap-server/tap/sync"
QUERY = """
SELECT TOP 1000 source_id, ref_epoch, ra, dec, pmra, pmdec,
  ra_error, dec_error, pmra_error, pmdec_error
FROM gaiadr3.gaia_source
WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', 210.80227, 54.34895, 0.09))
"""
REQUIRED_MOTION = ("pmra", "pmdec", "pmra_error", "pmdec_error")
RADIUS_ARCSEC = 3.0


def matches_for(row, detections, catalog):
    epoch = Time(row["date"], scale="utc").tcb.jyear
    positions = SkyCoord([float(entry["ra"]) for entry in catalog],
                         [float(entry["dec"]) for entry in catalog], unit="deg")
    delta = epoch - np.array([float(entry["ref_epoch"]) for entry in catalog])
    pm_known = np.array([all(entry.get(key) for key in REQUIRED_MOTION) for entry in catalog])
    pm_ra = np.where(pm_known, [float(entry["pmra"] or 0) for entry in catalog], 0)
    pm_dec = np.where(pm_known, [float(entry["pmdec"] or 0) for entry in catalog], 0)
    angle = np.arctan2(pm_ra, pm_dec) * u.rad
    propagated = positions.directional_offset_by(angle, np.hypot(pm_ra, pm_dec) * delta * u.mas)
    position_error = np.hypot([float(entry["ra_error"]) for entry in catalog],
                              [float(entry["dec_error"]) for entry in catalog])
    motion_error = np.hypot([float(entry["pmra_error"] or 0) for entry in catalog],
                            [float(entry["pmdec_error"] or 0) for entry in catalog])
    error_arcsec = (position_error + abs(delta) * motion_error) / 1000

    results = []
    for detection in detections:
        source = SkyCoord(detection["ra"], detection["dec"], unit="deg")
        separation = source.separation(propagated).arcsec
        nearby = np.flatnonzero(separation <= RADIUS_ARCSEC + 3 * error_arcsec)
        results.append([
            {
                "sourceId": catalog[k]["source_id"],
                "separation": round(float(separation[k]), 4),
                "propagated": bool(pm_known[k]),
            }
            for k in sorted(nearby, key=lambda k: separation[k])
        ])
    return results


def main():
    params = urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": QUERY})
    with urlopen(f"{ENDPOINT}?{params}", timeout=30) as response:
        payload = response.read(1_000_001)
    if len(payload) > 1_000_000:
        raise ValueError("Gaia response exceeds the expected size.")
    catalog = list(csv.DictReader(io.StringIO(payload.decode("utf-8"))))
    if not 0 < len(catalog) < 1000:
        raise ValueError("The Gaia query was empty or reached its row limit.")
    observations = json.loads((ROOT / "src/observations.json").read_text())
    detections = json.loads((ROOT / "src/detections.json").read_text())
    results = {row["name"]: matches_for(row, detections[row["name"]], catalog)
               for row in observations}
    (ROOT / "src/gaiaMatches.json").write_text(
        json.dumps(results, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

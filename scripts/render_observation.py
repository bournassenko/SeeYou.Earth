import hashlib
import json
from pathlib import Path

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/spherex"
OUTPUT = ROOT / "public/observations"
OBSERVATIONS = {
    "m101-dr1-d2": ("2025W21_2C_0401_3D2", "l2b-v27-2026-199", "7e6459d988dfedff4eea7119b5f659b32cf43e20287d99f00cb3281ddf2253ef"),
    "m101-0650_3D2": ("2025W49_2A_0650_3D2", "l2b-v27-2026-209", "365c8d2e82ab6bafd1c8bd505503e60b4a21c43d801e9609b51c4b3781c3b49f"),
    "m101-0223_1D2": ("2025W50_1A_0223_1D2", "l2b-v27-2026-209", "c176fd974f19106c6cd64dc9329ea27f15139ac10a627418c320a09c0a7f219f"),
}


def render(name, observation_id, version, checksum, sky):
    source = RAW / f"{name}.fits"
    output = OUTPUT / name
    if hashlib.sha256(source.read_bytes()).hexdigest() != checksum:
        raise ValueError("The downloaded FITS file does not match the recorded cutout.")

    with fits.open(source) as observation:
        observation.verify("exception")
        pixels = observation["IMAGE"].data
        if pixels.ndim != 2:
            raise ValueError("Unexpected dimensions for the M101 cutout.")

        wcs = WCS(observation["IMAGE"].header, fobj=observation).celestial
        height, width = sky.shape
        x, y = wcs.world_to_pixel(sky)
        residual = wcs.pixel_to_world(x, y).separation(sky).arcsec
        np.testing.assert_allclose(residual, 0, atol=1e-4, rtol=0)

        nearest_x = np.rint(x).astype(int)
        nearest_y = np.rint(y).astype(int)
        inside = (
            (nearest_x >= 0)
            & (nearest_y >= 0)
            & (nearest_x < pixels.shape[1])
            & (nearest_y < pixels.shape[0])
        )
        aligned = np.full(sky.shape, np.nan, dtype=np.float32)
        aligned[inside] = pixels[nearest_y[inside], nearest_x[inside]]
        pixels = aligned

        center = SkyCoord(210.80227, 54.34895, unit="deg", frame="icrs")
        center_x, center_y = wcs.world_to_pixel(center)
        spectral = WCS(observation["IMAGE"].header, fobj=observation, key="W")
        spectral.sip = None
        wavelength, bandwidth = spectral.pixel_to_world(center_x, center_y)

        finite = np.isfinite(pixels)
        lower, upper = np.percentile(pixels[finite], [1, 99.5])
        if not lower < upper:
            raise ValueError("The selected stretch requires a nonzero intensity range.")

        display = np.zeros(pixels.shape, dtype=np.uint8)
        scaled = np.clip((pixels[finite] - lower) / (upper - lower), 0, 1)
        display[finite] = np.rint(255 * np.arcsinh(10 * scaled) / np.arcsinh(10))
        Image.fromarray(display).save(output.with_suffix(".png"))
        week = observation_id[:10]
        url = f"https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/{week}/{version}/2/level2_{observation_id}_spx_{version}.fits"
        return {
            "name": name,
            "id": observation_id,
            "date": observation["IMAGE"].header["DATE-OBS"],
            "detector": int(observation["IMAGE"].header["DETECTOR"]),
            "wavelength": wavelength.to_value(u.um),
            "bandwidth": bandwidth.to_value(u.um),
            "width": width,
            "height": height,
            "source": f"{url}?center=210.80227,54.34895d&size=0.1",
        }


def main():
    with fits.open(RAW / "m101-dr1-d2.fits") as reference:
        image = reference["IMAGE"]
        reference_wcs = WCS(image.header, fobj=reference).celestial
        rows, columns = np.indices(image.data.shape)
        sky = reference_wcs.pixel_to_world(columns, image.data.shape[0] - 1 - rows).icrs
        center = SkyCoord(210.80227, 54.34895, unit="deg", frame="icrs")
        if sky[29, 29].separation(center).arcsec >= 6.2:
            raise ValueError("The reference image center is outside the expected cutout.")

    entries = [render(name, *details, sky) for name, details in OBSERVATIONS.items()]
    coordinates = np.stack((sky.ra.deg, sky.dec.deg), axis=-1)
    (OUTPUT / "m101-dr1-d2.json").write_text(
        json.dumps(
            {"coordinates": coordinates.round(9).tolist()},
            allow_nan=False,
            separators=(",", ":"),
        ) + "\n",
        encoding="utf-8",
    )
    entries.sort(key=lambda entry: entry["date"])
    (ROOT / "src/observations.json").write_text(
        json.dumps(entries, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

import unittest

from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
import numpy as np

from server.spherex_series import detection_summary, sky_grid
from server.source_detection import SOURCE_FLAG


class SyntheticSourceMeasurementTests(unittest.TestCase):
    def setup_field(self, flags=0):
        grid, size = sky_grid(210.8, 54.3, 0.1)
        y, x = np.indices((size, size))
        width = 1.9
        x0, y0 = 29.2, 32.65
        source = 50 * np.exp(-((x - x0) ** 2 + (y - y0) ** 2) / (2 * width**2))
        noise = np.random.default_rng(41).normal(size=(size, size))
        image = fits.ImageHDU(source + noise + 8, header=grid.to_header(), name="IMAGE")
        image.header["PSF_FWHM"] = width * 2.355 * abs(grid.wcs.cdelt[0]) * 3600
        quality = np.zeros_like(image.data, dtype=np.int32)
        quality[31:35, 28:32] = flags
        hdus = fits.HDUList([
            fits.PrimaryHDU(), image,
            fits.ImageHDU(np.full_like(image.data, 8), name="ZODI"),
            fits.ImageHDU(np.ones_like(image.data), name="VARIANCE"),
            fits.ImageHDU(quality, name="FLAGS"),
        ])
        return hdus, grid, size, x0, y0

    def test_recovers_source_and_north_up_projection(self):
        hdus, grid, size, x0, y0 = self.setup_field(SOURCE_FLAG)
        result = detection_summary(hdus, WCS(hdus["IMAGE"].header), grid, size)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["total"], 1)
        source = result["sources"][0]
        expected = grid.pixel_to_world(x0, y0)
        measured = SkyCoord(source["ra"], source["dec"], unit="deg")
        self.assertLess(measured.separation(expected).arcsec, 2)
        self.assertAlmostEqual(source["x"], (x0 + 0.5) / size, delta=0.005)
        self.assertAlmostEqual(source["y"], (size - y0 - 0.5) / size, delta=0.005)
        self.assertGreater(source["peakSnr"], 5)

    def test_rejects_a_source_with_bad_quality_flags(self):
        hdus, grid, size, *_ = self.setup_field(1)
        result = detection_summary(hdus, WCS(hdus["IMAGE"].header), grid, size)
        self.assertEqual(result, {"status": "complete", "total": 0, "sources": []})

    def test_distinguishes_missing_calibration_from_no_sources(self):
        hdus, grid, size, *_ = self.setup_field()
        del hdus["VARIANCE"]
        result = detection_summary(hdus, WCS(hdus["IMAGE"].header), grid, size)
        self.assertEqual(result["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()

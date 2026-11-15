import unittest

from track_ztf import rank_tracks


class SyntheticTrajectoryTests(unittest.TestCase):
    def test_recovers_linear_motion_and_prefers_it_to_fixed_position(self):
        frames = [(float(day), [(2 * day, day, 0.1)]) for day in range(3)]
        candidate, = rank_tracks(frames)
        self.assertAlmostEqual(candidate["speedArcsecPerDay"], 5**0.5)
        self.assertAlmostEqual(candidate["reducedChiSquared"], 0)
        self.assertGreater(candidate["deltaChiSquared"], 25)

    def test_rejects_stationary_or_inconsistent_tracks(self):
        stationary = [(float(day), [(3, 4, 0.1)]) for day in range(3)]
        inconsistent = [(float(day), [(day, north, 0.1)])
                        for day, north in enumerate((0, 10, 0))]
        self.assertEqual(rank_tracks(stationary), [])
        self.assertEqual(rank_tracks(inconsistent), [])
        self.assertEqual(rank_tracks(stationary[:2] + [(2.0, [])]), [])


if __name__ == "__main__":
    unittest.main()

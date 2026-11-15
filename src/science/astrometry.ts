const arcsecPerRadian = (180 * 3600) / Math.PI;
const radians = Math.PI / 180;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const utcFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const astrometryHeader = "utc,ra_deg,dec_deg,sigma_arcsec";

export type Measurement = {
  utc: string;
  time: number;
  ra: number;
  dec: number;
  sigma: number;
};

export function parseAstrometry(csv: string): Measurement[] {
  if (csv.length > 64_000) throw new Error("The input exceeds 64 KB.");
  const [header, ...lines] = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (header?.trim() !== astrometryHeader) {
    throw new Error(`Use the header ${astrometryHeader}.`);
  }
  if (lines.length < 3 || lines.length > 200) {
    throw new Error("Provide 3 to 200 independently timed measurements.");
  }

  const measurements = lines
    .map((line, index) => {
      const [utc, ...fields] = line.split(",").map((field) => field.trim());
      const time = Date.parse(utc);
      if (
        !utcFormat.test(utc) ||
        !Number.isFinite(time) ||
        new Date(time).toISOString().slice(0, 19) !== utc.slice(0, 19)
      ) {
        throw new Error(
          `Row ${index + 1}: enter an ISO 8601 UTC time ending in Z.`,
        );
      }
      const [ra, dec, sigma] = fields.map(Number);
      if (
        fields.length !== 3 ||
        !fields.every((field) => decimal.test(field)) ||
        !(
          ra >= 0 &&
          ra < 360 &&
          dec >= -90 &&
          dec <= 90 &&
          sigma >= 0.000001 &&
          sigma <= 3600
        )
      ) {
        throw new Error(
          `Row ${index + 1}: check RA, Dec and the uncertainty in arcseconds.`,
        );
      }
      return { utc: new Date(time).toISOString(), time, ra, dec, sigma };
    })
    .sort((a, b) => a.time - b.time);

  if (
    new Set(measurements.map(({ time }) => time)).size !== measurements.length
  ) {
    throw new Error("Every measurement must have a distinct UTC time.");
  }
  return measurements;
}

function projection(origin: Measurement) {
  const ra0 = origin.ra * radians;
  const dec0 = origin.dec * radians;
  const sin0 = Math.sin(dec0);
  const cos0 = Math.cos(dec0);

  return {
    project(point: Measurement) {
      const angle = point.ra * radians - ra0;
      const dec = point.dec * radians;
      const sin = Math.sin(dec);
      const cos = Math.cos(dec);
      const dot = sin0 * sin + cos0 * cos * Math.cos(angle);
      if (dot < Math.cos(radians)) {
        throw new Error(
          "All measurements must lie within 1° of the first position.",
        );
      }
      return {
        east: (cos * Math.sin(angle) * arcsecPerRadian) / dot,
        north:
          ((cos0 * sin - sin0 * cos * Math.cos(angle)) * arcsecPerRadian) / dot,
      };
    },
    unproject(east: number, north: number) {
      const x = east / arcsecPerRadian;
      const y = north / arcsecPerRadian;
      const ra = (ra0 + Math.atan2(x, cos0 - y * sin0)) / radians;
      const dec =
        Math.atan2(sin0 + y * cos0, Math.hypot(cos0 - y * sin0, x)) / radians;
      return { ra: ((ra % 360) + 360) % 360, dec };
    },
  };
}

type FitPoint = { days: number; east: number; north: number; weight: number };

function fit(points: FitPoint[]) {
  const weight = points.reduce((sum, point) => sum + point.weight, 0);
  const mean = (key: "days" | "east" | "north") =>
    points.reduce((sum, point) => sum + point.weight * point[key], 0) / weight;
  const time = mean("days");
  const east = mean("east");
  const north = mean("north");
  const timeVariance = points.reduce(
    (sum, point) => sum + point.weight * (point.days - time) ** 2,
    0,
  );
  const slope = (key: "east" | "north") =>
    points.reduce(
      (sum, point) =>
        sum +
        point.weight *
          (point.days - time) *
          (point[key] - (key === "east" ? east : north)),
      0,
    ) / timeVariance;
  const eastRate = slope("east");
  const northRate = slope("north");
  return {
    stationary: { east, north },
    eastRate,
    northRate,
    predict: (days: number) => ({
      east: east + (days - time) * eastRate,
      north: north + (days - time) * northRate,
      sigma: Math.sqrt(1 / weight + (days - time) ** 2 / timeVariance),
    }),
  };
}

export function reviewAstrometry(measurements: Measurement[]) {
  const first = measurements[0];
  const transform = projection(first);
  const points = measurements.map((point) => ({
    ...transform.project(point),
    days: (point.time - first.time) / 86_400_000,
    weight: 1 / point.sigma ** 2,
  }));
  const model = fit(points);
  const residuals = points.map((point, index) => {
    const expected = model.predict(point.days);
    return {
      utc: measurements[index].utc,
      eastArcsec: point.east - expected.east,
      northArcsec: point.north - expected.north,
    };
  });
  const chiSquared = residuals.reduce(
    (sum, point, index) =>
      sum +
      points[index].weight *
        Math.hypot(point.eastArcsec, point.northArcsec) ** 2,
    0,
  );
  const stationaryChiSquared = points.reduce(
    (sum, point) =>
      sum +
      point.weight *
        Math.hypot(
          point.east - model.stationary.east,
          point.north - model.stationary.north,
        ) **
          2,
    0,
  );
  const latest = points.at(-1)!;
  const withheld = fit(points.slice(0, -1)).predict(latest.days);
  const separation = Math.hypot(
    latest.east - withheld.east,
    latest.north - withheld.north,
  );

  return {
    spanDays: latest.days,
    eastRate: model.eastRate,
    northRate: model.northRate,
    speedArcsecPerDay: Math.hypot(model.eastRate, model.northRate),
    chiSquared,
    stationaryChiSquared,
    degreesOfFreedom: 2 * points.length - 4,
    residuals,
    withheld: {
      utc: measurements.at(-1)!.utc,
      predicted: transform.unproject(withheld.east, withheld.north),
      predictedSigmaArcsec: withheld.sigma,
      residualArcsec: separation,
      combinedSigmaArcsec: Math.hypot(
        withheld.sigma,
        measurements.at(-1)!.sigma,
      ),
    },
  };
}

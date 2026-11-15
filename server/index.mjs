import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const endpoint = "https://irsa.ipac.caltech.edu/SIA";
const fitsPath = /^\/ibe\/data\/spherex\/dr1\/level2\/[\w/-]+\.fits$/;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const maximumConcurrentSearches = 4;
let activeSearches = 0;
let activeSeries = 0;
const seriesScript = fileURLToPath(
  new URL("./spherex_series.py", import.meta.url),
);
const maximumSeries = 2;
const seriesCache = new Map();
const maximumCacheEntries = 12;
const cacheLifetime = 30 * 60 * 1000;

function coordinate(params, name) {
  const value = params.get(name);
  return value !== null && decimal.test(value) ? Number(value) : NaN;
}

function archiveRows(document, limit) {
  const result = document.VOTABLE?.RESOURCE_ARRAY?.find(
    (entry) => entry["<xmlattr>"]?.type === "results",
  );
  const status = result?.INFO_ARRAY?.find(
    (info) => info["<xmlattr>"]?.name === "QUERY_STATUS",
  )?.["<xmlattr>"]?.value;
  if (!["OK", "OVERFLOW"].includes(status)) {
    throw new Error("IRSA returned an invalid search status.");
  }

  const fields = result.TABLE?.FIELD_ARRAY?.map(
    (field) => field["<xmlattr>"]?.name,
  );
  const table = result.TABLE?.DATA?.TABLEDATA;
  const columns = [
    "access_url",
    "obs_id",
    "energy_bandpassname",
    "t_min",
    "s_ra",
    "s_dec",
  ].map((name) => fields?.indexOf(name) ?? -1);
  if (columns.some((column) => column < 0)) {
    throw new Error("IRSA returned an unexpected set of columns.");
  }
  if (table === undefined || table === "") return [];
  if (!Array.isArray(table))
    throw new Error("IRSA returned an invalid result table.");

  return table.slice(0, limit).map((row) => {
    const [source, id, detector, mjd, pointingRa, pointingDec] = columns.map(
      (column) => row[column],
    );
    const url = new URL(source);
    if (
      url.origin !== "https://irsa.ipac.caltech.edu" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !fitsPath.test(url.pathname)
    ) {
      throw new Error("IRSA returned an unexpected FITS URL.");
    }
    const timestamp =
      mjd != null && String(mjd).trim() !== ""
        ? new Date((Number(mjd) - 40587) * 86400000)
        : undefined;
    const date =
      timestamp && Number.isFinite(timestamp.getTime())
        ? timestamp.toISOString()
        : null;
    return {
      id,
      detector,
      date,
      source: url.href,
      pointing: [Number(pointingRa), Number(pointingDec)],
    };
  });
}

function sampleObservations(observations) {
  const detectors = Map.groupBy(
    observations.filter(
      (entry) => entry.date && /^SPHEREx-D[1-6]$/.test(entry.detector),
    ),
    (entry) => entry.detector,
  );
  return [...detectors.values()]
    .flatMap((entries) => {
      entries.sort((a, b) => a.date.localeCompare(b.date));
      if (entries.length <= 4) return entries;
      const times = entries.map(({ date }) => Date.parse(date) / 86400000);
      let best = Infinity;
      let pair = [];
      for (let first = 0; first < entries.length - 1; first++) {
        for (let last = first + 1; last < entries.length; last++) {
          const days = times[last] - times[first];
          if (days < 30) continue;
          const [a, b] = [entries[first].pointing, entries[last].pointing];
          const dra = Math.abs(a[0] - b[0]);
          const latitude = ((a[1] + b[1]) * Math.PI) / 360;
          const separation = Math.hypot(
            Math.min(dra, 360 - dra) * Math.cos(latitude),
            a[1] - b[1],
          );
          const score = separation + 0.002 * Math.abs(days - 365);
          if (score < best) {
            best = score;
            pair = [entries[first], entries[last]];
          }
        }
      }

      const chosen = new Set([entries[0], entries.at(-1), ...pair]);
      for (const fraction of [1 / 3, 2 / 3, 1 / 2]) {
        if (chosen.size === 4) break;
        chosen.add(entries[Math.round((entries.length - 1) * fraction)]);
      }
      return [...chosen];
    })
    .map(({ id, detector, date, source }) => ({ id, detector, date, source }));
}

function renderSeries(input, signal) {
  return new Promise((resolve, reject) => {
    const worker = execFile(
      process.env.SPHEREX_PYTHON ?? "python3",
      [seriesScript],
      { signal, timeout: 65000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
    worker.stdin.on("error", reject);
    worker.stdin.end(JSON.stringify(input));
  });
}

const server = createServer(async (request, response) => {
  const send = (status, body) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(body));
  };

  const url = URL.parse(request.url ?? "/", "http://localhost");
  if (url?.pathname === "/api/health" && request.method === "GET") {
    return send(200, { status: "ok" });
  }
  if (url?.pathname !== "/api/observations" || request.method !== "GET") {
    return send(404, { error: "Not found." });
  }

  const ra = coordinate(url.searchParams, "ra");
  const dec = coordinate(url.searchParams, "dec");
  const fov = coordinate(url.searchParams, "fov");
  if (!(
    ra >= 0 &&
    ra < 360 &&
    dec >= -90 &&
    dec <= 90 &&
    fov / 2 > 0 &&
    fov <= 180
  )) {
    return send(400, { error: "Invalid sky coordinates or field of view." });
  }
  const series = url.searchParams.get("mode") === "series";
  if (series && (fov < 0.02 || fov > 0.4)) {
    return send(400, {
      error: "Field of view must be between 0.02° and 0.4°.",
    });
  }
  const key = series && JSON.stringify([ra, dec, fov]);
  const cached = key && seriesCache.get(key);
  if (cached) {
    if (cached.expires > Date.now()) return send(200, cached.data);
    seriesCache.delete(key);
  }
  if (
    activeSearches >= maximumConcurrentSearches ||
    (series && activeSeries >= maximumSeries)
  ) {
    return send(503, { error: "The search is busy. Try again shortly." });
  }

  const client = new AbortController();
  const onClose = () => client.abort();
  response.once("close", onClose);
  activeSearches += 1;
  if (series) activeSeries += 1;
  try {
    const archiveUrl = new URL(endpoint);
    const limit = series ? 2000 : 5;
    archiveUrl.search = new URLSearchParams({
      COLLECTION: "spherex_dr1",
      POS: `CIRCLE ${ra} ${dec} ${series ? 0.00001 : fov / 2}`,
      MAXREC: String(limit),
      RESPONSEFORMAT: "json",
    });
    const upstream = await fetch(archiveUrl, {
      signal: AbortSignal.any([client.signal, AbortSignal.timeout(20000)]),
    });
    if (!upstream.ok) throw new Error(`IRSA returned HTTP ${upstream.status}.`);
    const observations = archiveRows(await upstream.json(), limit);
    if (!series) {
      return send(200, {
        observations: observations.map(({ id, detector, date, source }) => ({
          id,
          detector,
          date,
          source,
        })),
      });
    }
    const entries = sampleObservations(observations);
    const result = entries.length
      ? await renderSeries({ ra, dec, fov, entries }, client.signal)
      : { series: [], all: null, failed: 0, sampled: 0 };
    const data = { ...result, ra, dec, fov, matched: observations.length };
    if (result.all?.frames.length > 1) {
      if (seriesCache.size >= maximumCacheEntries) {
        seriesCache.delete(seriesCache.keys().next().value);
      }
      seriesCache.set(key, { data, expires: Date.now() + cacheLifetime });
    }
    send(200, data);
  } catch (error) {
    if (client.signal.aborted || response.destroyed) return;
    console.error("IRSA search failed:", error.message);
    send(502, { error: "The IRSA archive is currently unavailable." });
  } finally {
    response.off("close", onClose);
    activeSearches -= 1;
    if (series) activeSeries -= 1;
  }
});

server.listen(Number(process.env.PORT ?? "4323"), "127.0.0.1");

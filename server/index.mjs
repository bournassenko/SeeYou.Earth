import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

const endpoint = "https://irsa.ipac.caltech.edu/SIA";
const fitsPath = /^\/ibe\/data\/spherex\/(dr1|qr3)\/level2\/[\w/-]+\.fits$/;
const collections = [
  "spherex_dr1",
  "spherex_qr3",
  "spherex_dr1_deep",
  "spherex_qr3_deep",
];
const dayMilliseconds = 86400000;
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

function archiveRows(document, limit, collection) {
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
  if (table === undefined || table === "")
    return { rows: [], truncated: status === "OVERFLOW" };
  if (!Array.isArray(table))
    throw new Error("IRSA returned an invalid result table.");

  const rows = table.slice(0, limit).map((row) => {
    const [source, id, detector, mjd, pointingRa, pointingDec] = columns.map(
      (column) => row[column],
    );
    const url = new URL(source);
    const release = fitsPath.exec(url.pathname)?.[1];
    if (
      url.origin !== "https://irsa.ipac.caltech.edu" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      release !== collection.split("_")[1]
    ) {
      throw new Error("IRSA returned an unexpected FITS URL.");
    }
    const timestamp =
      mjd != null && String(mjd).trim() !== ""
        ? new Date((Number(mjd) - 40587) * dayMilliseconds)
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
      release: release.toUpperCase(),
      pointing: [Number(pointingRa), Number(pointingDec)],
    };
  });
  return { rows, truncated: status === "OVERFLOW" };
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
      if (entries.length <= 5) return entries;
      const times = entries.map(
        ({ date }) => Date.parse(date) / dayMilliseconds,
      );
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
      for (const release of Map.groupBy(
        entries,
        (entry) => entry.release,
      ).values()) {
        if (chosen.size === 5) break;
        chosen.add(release.at(-1));
      }
      for (const fraction of [1 / 3, 2 / 3, 1 / 2]) {
        if (chosen.size === 5) break;
        chosen.add(entries[Math.round((entries.length - 1) * fraction)]);
      }
      return [...chosen];
    })
    .map(({ id, detector, date, source, release }) => ({
      id,
      detector,
      date,
      source,
      release,
    }));
}

function dateBoundary(value) {
  if (value === null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === value
    ? milliseconds
    : NaN;
}

async function searchCollection(
  collection,
  { ra, dec, radius, limit, from, until },
  signal,
) {
  const archiveUrl = new URL(endpoint);
  archiveUrl.search = new URLSearchParams({
    COLLECTION: collection,
    POS: `CIRCLE ${ra} ${dec} ${radius}`,
    MAXREC: String(limit),
    RESPONSEFORMAT: "json",
  });
  if (from !== undefined || until !== undefined) {
    const lower = from === undefined ? "-Inf" : from / dayMilliseconds + 40587;
    const upper =
      until === undefined ? "+Inf" : until / dayMilliseconds + 40587;
    archiveUrl.searchParams.set("TIME", `${lower} ${upper}`);
  }
  const upstream = await fetch(archiveUrl, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!upstream.ok) throw new Error(`IRSA returned HTTP ${upstream.status}.`);
  return archiveRows(await upstream.json(), limit, collection);
}

function renderSeries(input, signal, onProgress) {
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
    if (onProgress) {
      const lines = createInterface({ input: worker.stderr });
      lines.on("line", (line) => {
        if (!line.startsWith("PROGRESS ")) return;
        const [completed, usable] = line.slice(9).split(" ").map(Number);
        if (Number.isInteger(completed) && Number.isInteger(usable))
          onProgress(completed, usable);
      });
    }
    worker.stdin.on("error", reject);
    worker.stdin.end(
      JSON.stringify({ ...input, reportProgress: Boolean(onProgress) }),
    );
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
  const from = dateBoundary(url.searchParams.get("from"));
  const through = dateBoundary(url.searchParams.get("to"));
  if (Number.isNaN(from) || Number.isNaN(through) || from > through) {
    return send(400, { error: "Invalid UTC observation date range." });
  }
  const until = through === undefined ? undefined : through + dayMilliseconds;
  const key = series && JSON.stringify([ra, dec, fov, from, through]);
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

  const streaming = series && url.searchParams.get("progress") === "1";
  function writeEvent(event) {
    if (streaming && !response.destroyed && !response.writableEnded) {
      response.write(JSON.stringify(event) + "\n");
    }
  }
  if (streaming) {
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    });
    writeEvent({ type: "search" });
  }

  const client = new AbortController();
  const onClose = () => client.abort();
  response.once("close", onClose);
  activeSearches += 1;
  if (series) activeSeries += 1;
  try {
    const requested = series ? collections : [collections[0]];
    const search = {
      ra,
      dec,
      radius: series ? 0.00001 : fov / 2,
      limit: series ? 2000 : 5,
      from,
      until,
    };
    const retrieved = await Promise.allSettled(
      requested.map((collection) =>
        searchCollection(collection, search, client.signal),
      ),
    );
    const archiveCollections = retrieved.map((result, index) => ({
      id: requested[index],
      status:
        result.status === "rejected"
          ? "unavailable"
          : result.value.truncated
            ? "truncated"
            : "complete",
    }));
    if (retrieved.every((result) => result.status === "rejected"))
      throw retrieved[0].reason;
    const unique = new Map();
    for (const result of retrieved) {
      if (result.status !== "fulfilled") continue;
      for (const row of result.value.rows) {
        const time = Date.parse(row.date);
        if (
          (from !== undefined && !(time >= from)) ||
          (until !== undefined && !(time < until))
        )
          continue;
        if (!unique.has(row.source)) unique.set(row.source, row);
      }
    }
    const observations = [...unique.values()];
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
    const reportCutouts = (completed, usable) =>
      writeEvent({
        type: "cutouts",
        completed,
        usable,
        total: entries.length,
        matched: observations.length,
      });
    reportCutouts(0, 0);
    const result = entries.length
      ? await renderSeries(
          { ra, dec, fov, entries },
          client.signal,
          streaming ? reportCutouts : undefined,
        )
      : { series: [], all: null, failed: 0, sampled: 0 };
    const matchCounts = Object.fromEntries(
      ["DR1", "QR3"].map((release) => [
        release,
        observations.filter((row) => row.release === release).length,
      ]),
    );
    const data = {
      ...result,
      ra,
      dec,
      fov,
      matched: observations.length,
      matchCounts,
      archiveCollections,
    };
    if (
      result.all?.frames.length > 1 &&
      archiveCollections.every(({ status }) => status !== "unavailable")
    ) {
      if (seriesCache.size >= maximumCacheEntries) {
        seriesCache.delete(seriesCache.keys().next().value);
      }
      seriesCache.set(key, { data, expires: Date.now() + cacheLifetime });
    }
    if (streaming) {
      writeEvent({ type: "result", data });
      response.end();
    } else {
      send(200, data);
    }
  } catch (error) {
    if (client.signal.aborted || response.destroyed) return;
    console.error("IRSA search failed:", error.message);
    if (streaming) {
      writeEvent({ type: "error" });
      response.end();
    } else {
      send(502, { error: "The IRSA archive is currently unavailable." });
    }
  } finally {
    response.off("close", onClose);
    activeSearches -= 1;
    if (series) activeSeries -= 1;
  }
});

server.listen(Number(process.env.PORT ?? "4323"), "127.0.0.1");

import { createServer } from "node:http";

const endpoint = "https://irsa.ipac.caltech.edu/SIA";
const fitsPath = /^\/ibe\/data\/spherex\/dr1\/level2\/[\w/-]+\.fits$/;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const maximumConcurrentSearches = 4;
let activeSearches = 0;

function coordinate(params, name) {
  const value = params.get(name);
  return value !== null && decimal.test(value) ? Number(value) : NaN;
}

function archiveRows(document) {
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
  const columns = ["access_url", "obs_id", "energy_bandpassname", "t_min"].map(
    (name) => fields?.indexOf(name) ?? -1,
  );
  if (columns.some((column) => column < 0)) {
    throw new Error("IRSA returned an unexpected set of columns.");
  }
  if (table === undefined || table === "") return [];
  if (!Array.isArray(table))
    throw new Error("IRSA returned an invalid result table.");

  return table.slice(0, 5).map((row) => {
    const [source, id, detector, mjd] = columns.map((column) => row[column]);
    const url = new URL(source);
    if (
      url.origin !== "https://irsa.ipac.caltech.edu" ||
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
    return { id, detector, date, source: url.href };
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
  if (activeSearches >= maximumConcurrentSearches) {
    return send(503, { error: "The search is busy. Try again shortly." });
  }

  const client = new AbortController();
  const onClose = () => client.abort();
  response.once("close", onClose);
  activeSearches += 1;
  try {
    const archiveUrl = new URL(endpoint);
    archiveUrl.search = new URLSearchParams({
      COLLECTION: "spherex_dr1",
      POS: `CIRCLE ${ra} ${dec} ${fov / 2}`,
      MAXREC: "5",
      RESPONSEFORMAT: "json",
    });
    const upstream = await fetch(archiveUrl, {
      signal: AbortSignal.any([client.signal, AbortSignal.timeout(20000)]),
    });
    if (!upstream.ok) throw new Error(`IRSA returned HTTP ${upstream.status}.`);
    send(200, { observations: archiveRows(await upstream.json()) });
  } catch (error) {
    if (client.signal.aborted || response.destroyed) return;
    console.error("IRSA search failed:", error.message);
    send(502, { error: "The IRSA archive is currently unavailable." });
  } finally {
    response.off("close", onClose);
    activeSearches -= 1;
  }
});

server.listen(Number(process.env.PORT ?? "4323"), "127.0.0.1");

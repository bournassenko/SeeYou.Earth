import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const targets = ["barnard", "epsilon", "wise", "rw", "dra", "nep", "sep"];
const base = process.argv[2];

function checkFrames(frames) {
  assert(frames.length > 1);
  let previous = 0;
  let dimensions;
  for (const frame of frames) {
    const date = Date.parse(frame.date);
    assert(Number.isFinite(date) && date >= previous);
    previous = date;
    assert(frame.coverage >= 0.25 && frame.coverage <= 1);
    assert(frame.wavelength > 0 && frame.bandwidth > 0);
    assert.match(frame.cutoutSha256, /^[a-f0-9]{64}$/);
    assert.equal(frame.detection.status, "complete");
    assert(frame.detection.total >= frame.detection.sources.length);
    assert(frame.detection.sources.length <= 150);
    for (const source of frame.detection.sources) {
      assert(source.ra >= 0 && source.ra < 360);
      assert(source.dec >= -90 && source.dec <= 90);
      assert(source.x >= 0 && source.x < 1 && source.y >= 0 && source.y < 1);
      assert(source.peakSnr >= 5);
    }
    const cutout = new URL(frame.cutout);
    assert.equal(cutout.origin, "https://irsa.ipac.caltech.edu");
    assert.match(
      cutout.pathname,
      /^\/ibe\/data\/spherex\/(dr1|qr3)\/level2\/.+\.fits$/,
    );
    assert(
      cutout.searchParams.has("center") && cutout.searchParams.has("size"),
    );
    const png = Buffer.from(frame.image, "base64");
    assert(png.subarray(0, 8).equals(pngSignature));
    const shape = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert(shape[0] === shape[1] && shape[0] >= 12 && shape[0] <= 256);
    dimensions ??= shape;
    assert.deepEqual(shape, dimensions);
  }
  assert.notEqual(frames[0].date, frames.at(-1).date);
}

for (const target of targets) {
  const url = `/observations/examples/${target}.json`;
  const data = base
    ? await fetch(new URL(url, base)).then((response) => {
        assert(response.ok, `HTTP ${response.status} for ${target}`);
        return response.json();
      })
    : JSON.parse(
        await readFile(new URL(`../public${url}`, import.meta.url), "utf8"),
      );
  assert.equal(data.detectionMethod.id, "spherex-daofind-v1");
  assert(data.all.frames.some((frame) => frame.detection.total > 0));
  if (target === "nep" || target === "sep") {
    assert(data.matchCounts.DR1 > 0 && data.matchCounts.QR3 > 0);
    assert(data.all.frames.some((frame) => frame.release === "QR3"));
    assert(
      data.series.some(
        (group) =>
          new Set(group.frames.map((frame) => frame.release)).size === 2,
      ),
    );
  }
  assert(data.series.length > 0, `No comparable sequence for ${target}`);
  checkFrames(data.all.frames);
  for (const group of data.series) {
    checkFrames(group.frames);
    assert(group.comparable);
    assert.equal(new Set(group.frames.map((frame) => frame.detector)).size, 1);
    assert(
      Math.max(...group.frames.map((f) => f.wavelength - f.bandwidth / 2)) <=
        Math.min(...group.frames.map((f) => f.wavelength + f.bandwidth / 2)),
    );
  }
  console.log(
    `${target}: ${data.all.frames.length} frames, ${data.series.length} comparable groups`,
  );
}

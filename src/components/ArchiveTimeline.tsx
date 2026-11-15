import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Download from "lucide-solid/icons/download";
import MapPin from "lucide-solid/icons/map-pin";
import PinOff from "lucide-solid/icons/pin-off";
import Pause from "lucide-solid/icons/pause";
import Play from "lucide-solid/icons/play";
import Split from "lucide-solid/icons/split";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import ComparisonDivider from "./ComparisonDivider";
import PlaybackSpeed from "./PlaybackSpeed";
import SelectField from "./SelectField";

type DetectedSource = {
  ra: number;
  dec: number;
  peakSnr: number;
  x: number;
  y: number;
};

type Detection =
  | { status: "complete"; total: number; sources: DetectedSource[] }
  | { status: "unavailable"; reason: string };

type ArchiveFrame = {
  id: string;
  date: string;
  detector: string;
  wavelength: number;
  bandwidth: number;
  coverage: number;
  cutout: string;
  cutoutSha256?: string;
  detection?: Detection;
  image: string;
};

type Timeline = {
  comparable: boolean;
  frames: ArchiveFrame[];
  stretch?: [number, number];
};

export type ArchiveSeries = {
  ra: number;
  dec: number;
  fov: number;
  matched: number;
  sampled: number;
  failed: number;
  detectionMethod?: {
    id: string;
    minimumPeakSnr: number;
    maxReportedSources: number;
  };
  series: Timeline[];
  all: Timeline | null;
};

export default function ArchiveTimeline(props: {
  result: ArchiveSeries;
  heading: string;
  archived: boolean;
  speed: number;
  setSpeed: (value: number) => void;
}) {
  const [mode, setMode] = createSignal(
    props.result.series.length ? "0" : "all",
  );
  const [index, setIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [markers, setMarkers] = createSignal(true);
  const [referenceIndex, setReferenceIndex] = createSignal<number>();
  const [divider, setDivider] = createSignal(50);
  const [pin, setPin] = createSignal<{
    source: DetectedSource;
    number: number;
    date: string;
    cutout: string;
  }>();
  const markerLimit = 30;
  const timeline = () =>
    mode() === "all" ? props.result.all : props.result.series[Number(mode())];
  const frames = () => timeline()?.frames ?? [];
  const frame = () => frames()[index()];
  const referenceFrame = () => {
    const reference = referenceIndex();
    return reference === undefined ? undefined : frames()[reference];
  };
  const frameOption = (entry: ArchiveFrame, i: number) => ({
    value: String(i),
    label: `${entry.date.replace("T", " ").slice(0, 19)} · ${entry.detector.replace("SPHEREx-", "")}`,
  });
  const detection = () => {
    const result = frame()?.detection;
    return result?.status === "complete" ? result : undefined;
  };

  function inspect(
    source: DetectedSource,
    number: number,
    observation: ArchiveFrame,
  ) {
    setPlaying(false);
    setPin({
      source,
      number,
      date: observation.date,
      cutout: observation.cutout,
    });
  }

  function evidence(observation: ArchiveFrame) {
    const { image, ...metadata } = observation;
    const payload = {
      schemaVersion: 1,
      release: "SPHEREx DR1",
      datasetDoi: "10.26131/IRSA678",
      coordinateFrame: "ICRS",
      coordinateUnit: "degree",
      field: {
        ra: props.result.ra,
        dec: props.result.dec,
        widthDeg: props.result.fov,
      },
      detectionMethod: props.result.detectionMethod ?? null,
      preview: {
        projection: "TAN",
        orientation: "north-up, east-left",
        sharedStretchMJySr: timeline()?.stretch ?? null,
      },
      observation: metadata,
    };
    return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
  }

  function step(direction: number) {
    const count = frames().length;
    const next = (index() + direction + count) % count;
    setIndex(
      next === referenceIndex() ? (next + direction + count) % count : next,
    );
  }

  function select(next: number) {
    setPlaying(false);
    setIndex(next);
  }

  createEffect(() => {
    if (!playing()) return;
    const timer = window.setInterval(() => step(1), 700 / props.speed);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <section
      class="viewer archive-viewer"
      aria-labelledby="archive-viewer-title"
    >
      <header class="viewer-header">
        <h2 id="archive-viewer-title">{props.heading}</h2>
        <div class="viewer-tools">
          <span class="archive-series-count">
            {props.archived ? "Archived example · " : ""}
            {frames().length} frames · {props.result.fov}° square
          </span>
          <Show when={detection()?.sources.length || (frame() && !markers())}>
            <button
              type="button"
              aria-pressed={markers()}
              onClick={() => setMarkers(!markers())}
            >
              <MapPin aria-hidden="true" /> Markers
            </button>
          </Show>
          <Show when={timeline()?.comparable && frames().length > 1}>
            <button
              type="button"
              aria-pressed={referenceIndex() !== undefined}
              onClick={() => {
                setPlaying(false);
                setDivider(50);
                setReferenceIndex((value) =>
                  value === undefined ? (index() === 0 ? 1 : 0) : undefined,
                );
              }}
            >
              <Split aria-hidden="true" /> Swipe compare
            </button>
          </Show>
        </div>
      </header>
      <Show
        when={frame()}
        fallback={
          <p role="status">
            {props.result.failed
              ? "No usable images could be loaded. Try again or choose another field."
              : "No usable SPHEREx images cover this position."}
          </p>
        }
      >
        {(current) => (
          <>
            <figure class="archive-frame">
              <div class="archive-image">
                <img
                  src={`data:image/png;base64,${current().image}`}
                  alt={`Aligned SPHEREx image at ${current().date} UTC`}
                />
                <Show when={referenceFrame()}>
                  {(reference) => (
                    <>
                      <img
                        class="comparison-image"
                        src={`data:image/png;base64,${reference().image}`}
                        alt=""
                        style={{
                          "clip-path": `inset(0 ${100 - divider()}% 0 0)`,
                        }}
                      />
                      <ComparisonDivider
                        id="archive-divider"
                        value={divider()}
                        onChange={setDivider}
                      />
                    </>
                  )}
                </Show>
                <Show when={markers() && !referenceFrame()}>
                  <For each={detection()?.sources.slice(0, markerLimit)}>
                    {(source, i) => (
                      <button
                        type="button"
                        class="source-marker"
                        aria-label={`Inspect source ${i() + 1}`}
                        aria-pressed={
                          pin()?.cutout === current().cutout &&
                          pin()?.number === i() + 1
                        }
                        style={{
                          left: `${source.x * 100}%`,
                          top: `${source.y * 100}%`,
                        }}
                        onClick={() => inspect(source, i() + 1, current())}
                      >
                        <span>{i() + 1}</span>
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={pin()} keyed>
                  {(selected) => (
                    <span
                      class="pixel-reticle pixel-reticle-pinned"
                      style={{
                        left: `${selected.source.x * 100}%`,
                        top: `${selected.source.y * 100}%`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                </Show>
              </div>
              <figcaption>
                <Show
                  when={referenceFrame()}
                  fallback="North up · East left · Masked pixels are blank"
                >
                  {(reference) => (
                    <>
                      <span>
                        Left · {reference().date.replace("T", " ").slice(0, 19)}{" "}
                        UTC
                      </span>
                      <span>
                        Right · {current().date.replace("T", " ").slice(0, 19)}{" "}
                        UTC
                      </span>
                    </>
                  )}
                </Show>
              </figcaption>
            </figure>
            <div class="viewer-inspector">
              <div class="timeline">
                <label for="archive-mode">Spectral selection</label>
                <SelectField
                  id="archive-mode"
                  label="Spectral selection"
                  value={mode()}
                  options={[
                    ...props.result.series.map((group, i) => ({
                      value: String(i),
                      label: `≈${group.frames[0]?.wavelength.toFixed(2)} µm · ${group.frames.length} frames`,
                    })),
                    { value: "all", label: "All sampled wavelengths" },
                  ]}
                  onChange={(value) => {
                    select(0);
                    setReferenceIndex(undefined);
                    setMode(value);
                  }}
                />
                <label for="archive-frame">Observation (UTC)</label>
                <SelectField
                  id="archive-frame"
                  label="Observation (UTC)"
                  value={String(index())}
                  options={frames()
                    .map(frameOption)
                    .filter(
                      (option) => Number(option.value) !== referenceIndex(),
                    )}
                  onChange={(value) => select(Number(value))}
                />
                <Show when={referenceFrame()}>
                  <label for="archive-reference">
                    Reference observation (UTC)
                  </label>
                  <SelectField
                    id="archive-reference"
                    label="Reference observation (UTC)"
                    value={String(referenceIndex())}
                    options={frames()
                      .map(frameOption)
                      .filter((option) => Number(option.value) !== index())}
                    onChange={(value) => setReferenceIndex(Number(value))}
                  />
                </Show>
                <div
                  class="playback"
                  role="group"
                  aria-label="Observation playback"
                >
                  <button
                    type="button"
                    aria-label="Previous observation"
                    title="Previous observation"
                    disabled={frames().length < (referenceFrame() ? 3 : 2)}
                    onClick={() => {
                      setPlaying(false);
                      step(-1);
                    }}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={frames().length < 2}
                    onClick={() => {
                      setReferenceIndex(undefined);
                      setPlaying(!playing());
                    }}
                  >
                    {playing() ? (
                      <Pause aria-hidden="true" />
                    ) : (
                      <Play aria-hidden="true" />
                    )}
                    {playing() ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    aria-label="Next observation"
                    title="Next observation"
                    disabled={frames().length < (referenceFrame() ? 3 : 2)}
                    onClick={() => {
                      setPlaying(false);
                      step(1);
                    }}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
                <small>
                  {timeline()?.comparable
                    ? "Same detector and overlapping central wavelengths. The wavelength can vary across each image."
                    : "Wavelengths differ across frames. Changes in brightness may be spectral."}
                </small>
              </div>
              <PlaybackSpeed value={props.speed} onChange={props.setSpeed} />
              <Show when={pin()} keyed>
                {(selected) => (
                  <section class="archive-pin" aria-label="Pinned position">
                    <div>
                      <strong>
                        Source {selected.number} · {selected.date.slice(0, 10)}
                      </strong>
                      <button
                        type="button"
                        aria-label="Clear pinned position"
                        onClick={() => setPin(undefined)}
                      >
                        <PinOff aria-hidden="true" />
                      </button>
                    </div>
                    <small>
                      RA {selected.source.ra.toFixed(6)}° · Dec{" "}
                      {selected.source.dec.toFixed(6)}°
                    </small>
                    <small>
                      Peak SNR {selected.source.peakSnr.toFixed(1)} in the
                      original frame
                    </small>
                  </section>
                )}
              </Show>
              <div class="observation-context">
                <dl>
                  <div>
                    <dt>Detector</dt>
                    <dd>{current().detector}</dd>
                  </div>
                  <div>
                    <dt>Central wavelength</dt>
                    <dd>{current().wavelength.toFixed(3)} µm</dd>
                  </div>
                  <div>
                    <dt>Usable pixels</dt>
                    <dd>{(current().coverage * 100).toFixed(0)}%</dd>
                  </div>
                  <div>
                    <dt>Archive</dt>
                    <dd>
                      <a href={current().cutout}>SPHEREx DR1 FITS</a>
                    </dd>
                  </div>
                </dl>
                <small>
                  {props.result.sampled} of {props.result.matched} archive
                  products sampled
                  {props.result.failed
                    ? ` · ${props.result.failed} downloads failed`
                    : ""}
                </small>
              </div>
            </div>
            <details class="detections archive-detections">
              <summary>
                {detection()
                  ? `Detected sources (${detection()?.total})`
                  : "Source detections"}
              </summary>
              <div class="archive-source-actions">
                <a
                  href={evidence(current())}
                  download={`${current().id}-${current().detector}-sources.json`}
                >
                  <Download aria-hidden="true" /> Export frame report
                </a>
              </div>
              <Show
                when={detection()}
                fallback={
                  <p>Source measurements are unavailable for this exposure.</p>
                }
              >
                {(measured) => (
                  <>
                    <Show
                      when={measured().sources.length > 0}
                      fallback={
                        <p>No source passed the screening threshold.</p>
                      }
                    >
                      <div
                        class="table-scroll"
                        tabindex="0"
                        role="region"
                        aria-label="Frame source measurements"
                      >
                        <table>
                          <caption>
                            Single-exposure detections · source numbers apply to
                            this frame
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Source</th>
                              <th scope="col">RA (°)</th>
                              <th scope="col">Dec (°)</th>
                              <th scope="col">Peak SNR</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={measured().sources}>
                              {(source, i) => (
                                <tr>
                                  <td>
                                    <button
                                      type="button"
                                      class="source-row-button"
                                      aria-label={`Pin source ${i() + 1}`}
                                      onClick={() =>
                                        inspect(source, i() + 1, current())
                                      }
                                    >
                                      {i() + 1}
                                    </button>
                                  </td>
                                  <td>{source.ra.toFixed(6)}</td>
                                  <td>{source.dec.toFixed(6)}</td>
                                  <td>{source.peakSnr.toFixed(1)}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </Show>
                    <Show when={measured().total > measured().sources.length}>
                      <p>
                        Report limited to the {measured().sources.length}{" "}
                        strongest detections.
                      </p>
                    </Show>
                  </>
                )}
              </Show>
            </details>
          </>
        )}
      </Show>
    </section>
  );
}

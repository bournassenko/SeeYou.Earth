import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Pause from "lucide-solid/icons/pause";
import Play from "lucide-solid/icons/play";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";

import PlaybackSpeed from "./PlaybackSpeed";
import SelectField from "./SelectField";

type ArchiveFrame = {
  id: string;
  date: string;
  detector: string;
  wavelength: number;
  bandwidth: number;
  coverage: number;
  cutout: string;
  image: string;
};

type Timeline = { comparable: boolean; frames: ArchiveFrame[] };

export type ArchiveSeries = {
  ra: number;
  dec: number;
  fov: number;
  matched: number;
  sampled: number;
  failed: number;
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
  const timeline = () =>
    mode() === "all" ? props.result.all : props.result.series[Number(mode())];
  const frames = () => timeline()?.frames ?? [];
  const frame = () => frames()[index()];

  function step(direction: number) {
    setIndex(
      (value) => (value + direction + frames().length) % frames().length,
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
        <span class="archive-series-count">
          {props.archived ? "Archived example · " : ""}
          {frames().length} frames · {props.result.fov}° square
        </span>
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
              <img
                src={`data:image/png;base64,${current().image}`}
                alt={`Aligned SPHEREx image at ${current().date} UTC`}
              />
              <figcaption>
                North up · East left · Masked pixels are blank
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
                    setMode(value);
                  }}
                />
                <label for="archive-frame">Observation (UTC)</label>
                <SelectField
                  id="archive-frame"
                  label="Observation (UTC)"
                  value={String(index())}
                  options={frames().map((entry, i) => ({
                    value: String(i),
                    label: `${entry.date.replace("T", " ").slice(0, 19)} · ${entry.detector.replace("SPHEREx-", "")}`,
                  }))}
                  onChange={(value) => select(Number(value))}
                />
                <div
                  class="playback"
                  role="group"
                  aria-label="Observation playback"
                >
                  <button
                    type="button"
                    aria-label="Previous observation"
                    title="Previous observation"
                    disabled={frames().length < 2}
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
                    onClick={() => setPlaying(!playing())}
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
                    disabled={frames().length < 2}
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
          </>
        )}
      </Show>
    </section>
  );
}

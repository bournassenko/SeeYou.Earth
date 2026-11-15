import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Crosshair from "lucide-solid/icons/crosshair";
import Download from "lucide-solid/icons/download";
import Link from "lucide-solid/icons/link";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import MapPin from "lucide-solid/icons/map-pin";
import Minus from "lucide-solid/icons/minus";
import Pause from "lucide-solid/icons/pause";
import Pin from "lucide-solid/icons/pin";
import PinOff from "lucide-solid/icons/pin-off";
import Play from "lucide-solid/icons/play";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import Split from "lucide-solid/icons/split";
import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

import ArchiveTimeline, { type ArchiveSeries } from "./ArchiveTimeline";
import ComparisonDivider from "./ComparisonDivider";
import PlaybackSpeed from "./PlaybackSpeed";
import SelectField from "./SelectField";
import PixelSpectrum from "./PixelSpectrum";
import TermHelp from "./TermHelp";

import detections from "../detections.json";
import gaiaMatches from "../gaiaMatches.json";
import observations from "../observations.json";

type Pixel = { x: number; y: number };
type CoordinateGrid = { coordinates: [number, number][][] };
type ArchiveObservation = {
  id: string;
  detector: string;
  date: string | null;
  source: string;
};

const coordinateFields = [
  {
    id: "ra",
    label: "Right ascension (RA)",
    help: "Like longitude on a sky map. It increases eastward and wraps around at 360°.",
    example: "210.80227",
    hint: "0° to less than 360°",
    isValid: (value: number) => value >= 0 && value < 360,
    error: "Enter right ascension from 0 to less than 360.",
  },
  {
    id: "dec",
    label: "Declination (Dec)",
    help: "Like latitude on a sky map. The celestial equator is 0°, and the poles are ±90°.",
    example: "54.34895",
    hint: "−90° to +90°",
    isValid: (value: number) => value >= -90 && value <= 90,
    error: "Enter declination from −90 to 90.",
  },
  {
    id: "fov",
    label: "Field of view",
    help: "The angular width of the region to search, in degrees, centered on the coordinates you enter.",
    example: "0.1",
    hint: "Greater than 0°, up to 180°",
    isValid: (value: number) => value / 2 > 0 && value <= 180,
    error: "Enter a field of view greater than 0 and at most 180.",
  },
] as const;

const exampleFields = [
  {
    key: "barnard",
    name: "Barnard’s Star",
    ra: "269.452077",
    dec: "4.693365",
    fov: "0.2",
  },
  {
    key: "epsilon",
    name: "Epsilon Indi B",
    ra: "331.044147",
    dec: "-56.782844",
    fov: "0.12",
  },
  {
    key: "wise",
    name: "WISE 0855",
    ra: "133.795129",
    dec: "-7.245147",
    fov: "0.12",
  },
  {
    key: "rw",
    name: "RW Aurigae",
    ra: "76.956526",
    dec: "30.401438",
    fov: "0.08",
  },
  {
    key: "dra",
    name: "R Draconis",
    ra: "248.167611",
    dec: "66.754979",
    fov: "0.08",
  },
] as const;

type CoordinateId = (typeof coordinateFields)[number]["id"];
type FieldErrors = Partial<Record<CoordinateId, string>>;
type FieldSelection = [string, string, string, string?];
type ExampleField = (typeof exampleFields)[number];

export default function SkyExplorer(props: {
  demo?: boolean;
  compare?: boolean;
}) {
  const [errors, setErrors] = createSignal<FieldErrors>({});
  const [selection, setSelection] = createSignal<FieldSelection>();
  const [linkStatus, setLinkStatus] = createSignal("");
  const [heading, setHeading] = createSignal("Sky field");
  const live = !props.demo;
  const defaultExample = exampleFields.find(({ key }) => key === "wise")!;
  const pending = () => live && Boolean(selection());
  const result = () => {
    const response = archive();
    return response && "series" in response ? response : undefined;
  };
  let archiveRequest: AbortController | undefined;
  onCleanup(() => archiveRequest?.abort());
  const [archive, { refetch }] = createResource(selection, async (values) => {
    if (window.location.protocol === "tauri:")
      return { offline: true } as const;

    archiveRequest?.abort();
    const request = new AbortController();
    archiveRequest = request;
    try {
      const [ra, dec, fov, example] = values;
      const query = new URLSearchParams({ ra, dec, fov });
      if (live) query.set("mode", "series");
      const endpoint = example
        ? `/observations/examples/${example}.json`
        : `/api/observations?${query}`;
      const response = await fetch(endpoint, { signal: request.signal });
      if (response.status === 429 || response.status === 503)
        return { busy: true } as const;
      if (!response.ok) return { unavailable: true } as const;
      return (await response.json()) as
        ArchiveSeries | { observations: ArchiveObservation[] };
    } catch {
      return { unavailable: true } as const;
    } finally {
      if (archiveRequest === request) archiveRequest = undefined;
    }
  });
  const [ready, setReady] = createSignal(false);
  const [index, setIndex] = createSignal(0);
  const [speed, setSpeed] = createSignal(3);
  const [playing, setPlaying] = createSignal(false);
  const [markers, setMarkers] = createSignal(true);
  const [selectedSource, setSelectedSource] = createSignal<number>();
  const [comparing, setComparing] = createSignal(false);
  const [divider, setDivider] = createSignal(50);
  const reference = observations[0]!;
  const [pixel, setPixel] = createSignal<Pixel>();
  const [pinnedPixel, setPinnedPixel] = createSignal<Pixel>();
  const [pixelSamples] = createResource(
    ready,
    async (): Promise<Record<
      string,
      ([number, number, number] | null)[][]
    > | null> => {
      try {
        const response = await fetch("/observations/m101-pixel-samples.json");
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    },
  );
  const spectrum = () => {
    const point = pinnedPixel();
    const data = pixelSamples();
    if (!point || !data) return undefined;
    return observations.map((entry, index) => ({
      index,
      date: entry.date.slice(0, 10),
      values: data[entry.name]?.[point.y]?.[point.x] ?? null,
    }));
  };
  const [zoom, setZoom] = createSignal(1);
  const activePixel = () => pinnedPixel() ?? pixel();
  let viewport: HTMLDivElement | undefined;
  const observation = () => observations[index()]!;
  const sources = () =>
    detections[observation().name as keyof typeof detections];
  const matches = (index: number) => {
    const source = sources()[index];
    if (!source) return undefined;
    return gaiaMatches[observation().name as keyof typeof gaiaMatches]?.find(
      (entry) => entry.ra === source.ra && entry.dec === source.dec,
    )?.nearby;
  };
  const inspected = () => {
    const selected = selectedSource();
    return selected === undefined ? undefined : sources()[selected];
  };
  const evidence = () => {
    const { id, date, detector, source, wavelength, bandwidth } = observation();
    return `data:application/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(
        {
          observation: {
            id,
            date: `${date}Z`,
            detector,
            source,
            wavelength,
            bandwidth,
          },
          frame: "ICRS",
          coordinateUnit: "degree",
          spectralUnit: "micrometer",
          catalog: "Gaia DR3",
          separationUnit: "arcsecond",
          detections: sources().map((entry, i) => ({
            ...entry,
            gaiaNearby: matches(i) ?? null,
          })),
        },
        null,
        2,
      ),
    )}`;
  };
  const [grid] = createResource(
    ready,
    async (): Promise<CoordinateGrid | null> => {
      try {
        const response = await fetch("/observations/m101-dr1-d2.json");
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    },
  );
  const sky = () => {
    const point = activePixel();
    return point && !grid.loading
      ? grid()?.coordinates[point.y]?.[point.x]
      : undefined;
  };

  function showObservation(next: number) {
    setIndex(next);
    setPixel(undefined);
    setSelectedSource(undefined);
    if (next === 0) setComparing(false);
  }

  function step(direction: number) {
    const count = observations.length;
    const next = (index() + direction + count) % count;
    showObservation(
      comparing() && next === 0 ? (next + direction + count) % count : next,
    );
  }

  function toggleComparison() {
    setPlaying(false);
    if (comparing()) {
      setComparing(false);
    } else {
      if (index() === 0) showObservation(1);
      setDivider(50);
      setComparing(true);
    }
  }

  function inspectSource(source: number) {
    setPlaying(false);
    setComparing(false);
    setMarkers(true);
    setSelectedSource((current) => (current === source ? undefined : source));
  }

  createEffect(() => {
    if (playing()) {
      const timer = window.setInterval(() => step(1), 1400 / speed());
      onCleanup(() => window.clearInterval(timer));
    }
  });

  function changeZoom(next: number) {
    if (!viewport || next === zoom()) return;
    const view = viewport;
    const point = activePixel();
    const { width, height } = observation();
    const x = point
      ? (point.x + 0.5) / width
      : (view.scrollLeft + view.clientWidth / 2) / view.scrollWidth;
    const y = point
      ? (point.y + 0.5) / height
      : (view.scrollTop + view.clientHeight / 2) / view.scrollHeight;
    setZoom(next);
    window.requestAnimationFrame(() => {
      view.scrollLeft = x * view.scrollWidth - view.clientWidth / 2;
      view.scrollTop = y * view.scrollHeight - view.clientHeight / 2;
    });
  }

  function togglePin() {
    if (pinnedPixel()) {
      setPinnedPixel(undefined);
      return;
    }
    const { width, height } = observation();
    setPinnedPixel(
      pixel() ?? { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    );
  }

  function readPointer(
    event: MouseEvent & { currentTarget: HTMLImageElement },
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const { width, height } = observation();
    const x = Math.floor(
      ((event.clientX - bounds.left) / bounds.width) * width,
    );
    const y = Math.floor(
      ((event.clientY - bounds.top) / bounds.height) * height,
    );
    const point =
      x >= 0 && y >= 0 && x < width && y < height ? { x, y } : undefined;
    setPixel(point);
    return point;
  }

  function readKeyboard(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      togglePin();
      return;
    }

    const offsets: Record<string, Pixel> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const offset = offsets[event.key];
    if (!offset) return;

    event.preventDefault();
    const { width, height } = observation();
    const point = activePixel() ?? {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
    };
    const next = {
      x: Math.min(width - 1, Math.max(0, point.x + offset.x)),
      y: Math.min(height - 1, Math.max(0, point.y + offset.y)),
    };
    if (pinnedPixel()) setPinnedPixel(next);
    else setPixel(next);

    if (viewport && zoom() > 1) {
      const x = ((next.x + 0.5) / width) * viewport.scrollWidth;
      const y = ((next.y + 0.5) / height) * viewport.scrollHeight;
      if (
        x < viewport.scrollLeft ||
        x >= viewport.scrollLeft + viewport.clientWidth
      ) {
        viewport.scrollLeft = x - viewport.clientWidth / 2;
      }
      if (
        y < viewport.scrollTop ||
        y >= viewport.scrollTop + viewport.clientHeight
      ) {
        viewport.scrollTop = y - viewport.clientHeight / 2;
      }
    }
  }

  const decimalDegrees = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  let demoExplorer: HTMLElement | undefined;
  let coordinateForm: HTMLFormElement | undefined;
  let sourceDetails: HTMLDetailsElement | undefined;

  function runDemo(event: Event) {
    const action = (event as CustomEvent<string>).detail;
    if (action === "search") {
      setPlaying(false);
      setComparing(false);
      setPinnedPixel(undefined);
      setMarkers(true);
      showObservation(0);
      changeZoom(1);
      coordinateForm?.reset();
    } else if (action === "sources") {
      if (sourceDetails) sourceDetails.open = true;
    } else if (action === "compare") {
      if (sourceDetails) sourceDetails.open = false;
      setSelectedSource(undefined);
      setComparing(false);
    } else if (action === "spectrum") {
      setComparing(false);
      setPlaying(false);
      showObservation(0);
      setPinnedPixel(undefined);
    }
  }

  onMount(() => {
    if (props.demo && demoExplorer) {
      const target = demoExplorer;
      target.addEventListener("seeyou-demo", runDemo);
      onCleanup(() => target.removeEventListener("seeyou-demo", runDemo));
    }
    setReady(true);
    if (!live || !coordinateForm || window.location.protocol === "tauri:")
      return;
    const params = new URLSearchParams(window.location.search);
    const example = exampleFields.find(
      ({ key }) => key === params.get("target"),
    );
    if (example) {
      loadExample(example);
    } else if (coordinateFields.every(({ id }) => params.has(id))) {
      for (const { id } of coordinateFields) {
        const input = coordinateForm.elements.namedItem(id) as HTMLInputElement;
        input.value = params.get(id) ?? "";
      }
      coordinateForm.requestSubmit();
    } else if (props.compare) {
      loadExample(defaultExample);
    }
  });

  function fieldUrl(values?: FieldSelection) {
    const url = new URL(window.location.href);
    for (const key of ["target", "ra", "dec", "fov"])
      url.searchParams.delete(key);
    if (!values) return url;
    const [ra, dec, fov, example] = values;
    if (example) url.searchParams.set("target", example);
    else
      for (const [key, value] of Object.entries({ ra, dec, fov }))
        url.searchParams.set(key, value);
    return url;
  }

  function updateFieldLocation(values?: FieldSelection) {
    const url = fieldUrl(values);
    window.history.replaceState(window.history.state, "", url);
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      "[data-field-route]",
    )) {
      const destination = new URL(link.dataset.fieldRoute!, url);
      for (const key of ["target", "ra", "dec", "fov"]) {
        const value = url.searchParams.get(key);
        if (value !== null) destination.searchParams.set(key, value);
      }
      link.href = destination.href;
    }
  }

  function openField(values: FieldSelection, name: string) {
    setPlaying(false);
    setHeading(name);
    setLinkStatus("");
    setSelection(values);
    if (live && window.location.protocol !== "tauri:") {
      updateFieldLocation(values);
    }
  }

  function loadExample(example: ExampleField) {
    if (!coordinateForm) return;
    for (const { id } of coordinateFields) {
      const input = coordinateForm.elements.namedItem(id) as HTMLInputElement;
      input.value = example[id];
    }
    setErrors({});
    openField(
      [example.ra, example.dec, example.fov, example.key],
      example.name,
    );
  }

  async function copyFieldLink() {
    const url = fieldUrl(selection()).href;
    try {
      await navigator.clipboard.writeText(url);
      setLinkStatus("Field link copied.");
    } catch {
      setLinkStatus("Copy the field link from the address bar.");
    }
  }

  function submitCoordinates(
    event: SubmitEvent & { currentTarget: HTMLFormElement },
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextErrors: FieldErrors = {};
    const coordinates: [string, string, string] = ["", "", ""];

    for (const [index, field] of coordinateFields.entries()) {
      const input = String(formData.get(field.id) ?? "").trim();
      if (!decimalDegrees.test(input) || !field.isValid(Number(input))) {
        nextErrors[field.id] = field.error;
      }
      coordinates[index] = input;
    }

    setErrors(nextErrors);

    const firstInvalid = coordinateFields.find((field) => nextErrors[field.id]);
    if (firstInvalid) {
      form.querySelector<HTMLInputElement>(`#${firstInvalid.id}`)?.focus();
      return;
    }

    if (
      live &&
      (Number(coordinates[2]) < 0.02 || Number(coordinates[2]) > 0.4)
    ) {
      setErrors({ fov: "Enter a field of view from 0.02° to 0.4°." });
      form.querySelector<HTMLInputElement>("#fov")?.focus();
      return;
    }

    const example = exampleFields.find(
      ({ ra, dec, fov }) =>
        ra === coordinates[0] &&
        dec === coordinates[1] &&
        fov === coordinates[2],
    );
    openField(
      coordinates,
      example?.name ?? `RA ${coordinates[0]}° · Dec ${coordinates[1]}°`,
    );
  }

  return (
    <section
      class="explorer"
      aria-label="Sky explorer"
      ref={demoExplorer}
      data-demo-explorer={props.demo && ready() ? "ready" : undefined}
    >
      <div class="explorer-controls">
        <form
          class="coordinate-search"
          aria-label="Search sky coordinates"
          noValidate
          onSubmit={submitCoordinates}
          ref={coordinateForm}
        >
          <For each={coordinateFields}>
            {(field) => (
              <div class="coordinate-field">
                <div class="term-label">
                  <label for={field.id}>{field.label}</label>
                  <TermHelp term={field.label}>{field.help}</TermHelp>
                </div>
                <input
                  id={field.id}
                  name={field.id}
                  type="text"
                  inputmode="decimal"
                  value={field.example}
                  required
                  aria-invalid={Boolean(errors()[field.id])}
                  aria-describedby={`${field.id}-hint${errors()[field.id] ? ` ${field.id}-error` : ""}`}
                />
                <small id={`${field.id}-hint`}>
                  {live && field.id === "fov" ? "0.02° to 0.4°" : field.hint}
                </small>
                <Show when={errors()[field.id]}>
                  <span class="field-error" id={`${field.id}-error`}>
                    {errors()[field.id]}
                  </span>
                </Show>
              </div>
            )}
          </For>
          <button type="submit" disabled={!ready()}>
            <Search aria-hidden="true" /> Search archive
          </button>
        </form>
        <Show when={live}>
          <div class="example-fields">
            <label for="example-field">Example field</label>
            <SelectField
              id="example-field"
              label="Example field"
              options={exampleFields.map(({ key, name }) => ({
                value: key,
                label: name,
              }))}
              value={selection()?.[3]}
              placeholder="Choose a target"
              onChange={(key) => {
                const example = exampleFields.find(
                  (entry) => entry.key === key,
                );
                if (example) loadExample(example);
              }}
            />
            <Show when={pending()}>
              <div class="field-actions">
                <button type="button" onClick={copyFieldLink}>
                  <Link aria-hidden="true" /> Copy field link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (props.compare) {
                      loadExample(defaultExample);
                      return;
                    }
                    archiveRequest?.abort();
                    setSelection(undefined);
                    setLinkStatus("");
                    updateFieldLocation();
                    coordinateForm?.reset();
                  }}
                >
                  {props.compare ? "Reset comparison" : "Back to M101"}
                </button>
              </div>
              <Show when={linkStatus()}>
                <small role="status">{linkStatus()}</small>
              </Show>
            </Show>
          </div>
        </Show>
        <Show when={props.demo && selection()}>
          <section
            class="archive-results"
            aria-label="IRSA search results"
            aria-busy={archive.loading}
          >
            <h3 class="term-label">
              SPHEREx archive{" "}
              <TermHelp term="SPHEREx">
                A space telescope that surveys the sky at infrared wavelengths.
                The archive lists exposures that cover your search region.
              </TermHelp>
            </h3>
            <Show when={!archive.loading} fallback={<p>Searching IRSA…</p>}>
              <Show when={archive()} keyed>
                {(result) =>
                  "observations" in result ? (
                    <Show
                      when={result.observations.length > 0}
                      fallback={<p>No observations found.</p>}
                    >
                      <ul>
                        <For each={result.observations}>
                          {(entry) => (
                            <li>
                              <a href={entry.source}>
                                {entry.id} · {entry.detector}
                              </a>{" "}
                              · {entry.date?.slice(0, 10) ?? "Date unavailable"}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  ) : (
                    <p>
                      {"offline" in result
                        ? "Archive search is available in the web app."
                        : "IRSA search unavailable."}
                    </p>
                  )
                }
              </Show>
            </Show>
          </section>
        </Show>
      </div>
      <Show when={pending()}>
        <Show
          when={!archive.loading}
          fallback={
            <section class="viewer archive-state" aria-busy="true">
              <h2>{heading()}</h2>
              <p role="status">Loading and aligning SPHEREx exposures…</p>
            </section>
          }
        >
          <Show
            when={result()}
            keyed
            fallback={
              <section class="viewer archive-state">
                <h2>{heading()}</h2>
                <p role="status">
                  {window.location.protocol === "tauri:"
                    ? "Archive search is available in the web app."
                    : archive() && "busy" in archive()!
                      ? "The archive service is busy. Retry in a moment."
                      : "SPHEREx images are temporarily unavailable."}
                </p>
                <Show when={window.location.protocol !== "tauri:"}>
                  <button
                    class="archive-retry"
                    type="button"
                    onClick={() => refetch()}
                  >
                    <RotateCcw aria-hidden="true" /> Retry field
                  </button>
                </Show>
              </section>
            }
          >
            {(series) => (
              <ArchiveTimeline
                result={series}
                heading={heading()}
                archived={Boolean(selection()?.[3])}
                startComparing={props.compare}
                speed={speed()}
                setSpeed={setSpeed}
              />
            )}
          </Show>
        </Show>
      </Show>
      <div hidden={pending() || props.compare}>
        <section class="viewer" aria-labelledby="viewer-title">
          <div class="viewer-header">
            <h2 id="viewer-title">Pinwheel Galaxy · M101</h2>
            <div class="viewer-tools">
              <button
                type="button"
                aria-pressed={markers()}
                disabled={comparing()}
                onClick={() => setMarkers(!markers())}
              >
                <MapPin aria-hidden="true" /> Markers
              </button>
              <button
                type="button"
                aria-pressed={comparing()}
                onClick={toggleComparison}
              >
                <Split aria-hidden="true" /> Swipe compare
              </button>
            </div>
          </div>
          <div class="viewer-image">
            <figure>
              <div class="sky-window" ref={viewport}>
                <div class="sky-image" style={{ width: `${zoom() * 100}%` }}>
                  <img
                    src={`/observations/${observation().name}.png`}
                    width={observation().width}
                    height={observation().height}
                    alt="Grayscale SPHEREx infrared cutout of the Pinwheel Galaxy and surrounding sources"
                    tabindex="0"
                    aria-describedby="pixel-position"
                    onPointerMove={readPointer}
                    onPointerLeave={() => setPixel(undefined)}
                    onKeyDown={readKeyboard}
                    onClick={(event) => {
                      const point = readPointer(event);
                      const pinned = pinnedPixel();
                      if (
                        point &&
                        (point.x !== pinned?.x || point.y !== pinned?.y)
                      ) {
                        setPinnedPixel(point);
                      }
                    }}
                  />
                  <Show when={comparing()}>
                    <img
                      class="comparison-image"
                      src={`/observations/${reference.name}.png`}
                      width={reference.width}
                      height={reference.height}
                      alt=""
                      style={{
                        "clip-path": `inset(0 ${100 - divider()}% 0 0)`,
                      }}
                    />
                    <ComparisonDivider
                      id="swipe-divider"
                      value={divider()}
                      onChange={setDivider}
                    />
                  </Show>
                  <Show when={activePixel()} keyed>
                    {(point) => (
                      <span
                        class="pixel-reticle"
                        classList={{
                          "pixel-reticle-pinned": Boolean(pinnedPixel()),
                        }}
                        aria-hidden="true"
                        style={{
                          left: `${((point.x + 0.5) / observation().width) * 100}%`,
                          top: `${((point.y + 0.5) / observation().height) * 100}%`,
                        }}
                      />
                    )}
                  </Show>
                  <Show when={markers() && !comparing()}>
                    <For each={sources()}>
                      {(source, i) => (
                        <Show when={source.display} keyed>
                          {(position) => (
                            <button
                              class="source-marker"
                              type="button"
                              aria-label={`Inspect source ${i() + 1}`}
                              aria-pressed={selectedSource() === i()}
                              style={{
                                left: `${position.x * 100}%`,
                                top: `${position.y * 100}%`,
                              }}
                              onClick={() => inspectSource(i())}
                            >
                              <span>{i() + 1}</span>
                            </button>
                          )}
                        </Show>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
              <div
                class="image-controls"
                role="group"
                aria-label="Image inspection"
              >
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={zoom() === 1}
                  onClick={() => changeZoom(zoom() / 2)}
                >
                  <Minus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Reset zoom"
                  onClick={() => changeZoom(1)}
                >
                  <Crosshair aria-hidden="true" /> {zoom()}×
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  disabled={zoom() === 4}
                  onClick={() => changeZoom(zoom() * 2)}
                >
                  <Plus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-pressed={Boolean(pinnedPixel())}
                  onClick={togglePin}
                >
                  {pinnedPixel() ? (
                    <PinOff aria-hidden="true" />
                  ) : (
                    <Pin aria-hidden="true" />
                  )}
                  {pinnedPixel() ? "Unpin" : "Pin position"}
                </button>
              </div>
              <Show when={comparing()}>
                <div class="swipe-control">
                  <div class="comparison-labels">
                    <span>
                      {reference.date.slice(0, 10)} ·{" "}
                      {reference.wavelength.toFixed(3)} µm
                    </span>
                    <span>
                      {observation().date.slice(0, 10)} ·{" "}
                      {observation().wavelength.toFixed(3)} µm
                    </span>
                  </div>
                  <small>Both wavelength and observation time differ.</small>
                </div>
              </Show>
            </figure>
          </div>
          <div class="viewer-inspector">
            <div class="timeline">
              <div class="term-label">
                <label for="observation">Observation (UTC)</label>
                <TermHelp term="UTC">
                  Coordinated Universal Time, the common time standard used for
                  these observation timestamps.
                </TermHelp>
              </div>
              <SelectField
                id="observation"
                label="Observation (UTC)"
                options={observations
                  .map((entry, i) => ({
                    value: String(i),
                    label: entry.date.replace("T", " ").slice(0, 19),
                  }))
                  .filter((option) => !comparing() || option.value !== "0")}
                value={String(index())}
                onChange={(value) => {
                  setPlaying(false);
                  showObservation(Number(value));
                }}
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
                  onClick={() => {
                    setPlaying(false);
                    step(-1);
                  }}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComparing(false);
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
                  onClick={() => {
                    setPlaying(false);
                    step(1);
                  }}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </div>
            <PlaybackSpeed value={speed()} onChange={setSpeed} />
            <div class="observation-context">
              <dl>
                <div>
                  <dt>Archive</dt>
                  <dd>
                    <a href={observation().source}>SPHEREx DR1 · IRSA</a>
                  </dd>
                </div>
                <div>
                  <dt>Detector</dt>
                  <dd>{observation().detector}</dd>
                </div>
                <div>
                  <dt>Wavelength</dt>
                  <dd>≈{observation().wavelength.toFixed(3)} µm</dd>
                </div>
              </dl>
              <p id="pixel-position">
                {pinnedPixel() && sky() ? "Pinned · " : ""}
                <Show
                  when={sky()}
                  fallback={
                    grid.loading
                      ? "Loading coordinates…"
                      : grid() === null
                        ? "Coordinates unavailable."
                        : "Click or press Enter to pin a position."
                  }
                >
                  {(position) => (
                    <span>
                      RA {position()[0].toFixed(6)}° · Dec{" "}
                      {position()[1].toFixed(6)}°
                    </span>
                  )}
                </Show>
              </p>
            </div>
            <Show when={spectrum()}>
              {(samples) => (
                <PixelSpectrum
                  samples={samples()}
                  activeIndex={index()}
                  selectObservation={(next) => {
                    setPlaying(false);
                    setComparing(false);
                    showObservation(next);
                  }}
                />
              )}
            </Show>
            <Show when={pinnedPixel() && pixelSamples() === null}>
              <p role="status">Pixel spectrum unavailable.</p>
            </Show>
            <Show when={inspected()} keyed>
              {(source) => (
                <section
                  aria-label="Source inspection"
                  class="source-inspection"
                  aria-live="polite"
                >
                  <strong>Source {(selectedSource() ?? 0) + 1}</strong>
                  <span>
                    RA {source.ra.toFixed(5)}° · Dec {source.dec.toFixed(5)}°
                  </span>
                  <span>
                    Peak SNR {source.peakSnr.toFixed(1)} ·{" "}
                    <Show
                      when={matches(selectedSource() ?? 0)}
                      keyed
                      fallback="Gaia match unavailable"
                    >
                      {(nearby) => `${nearby.length} nearby Gaia entries`}
                    </Show>
                  </span>
                </section>
              )}
            </Show>
          </div>
          <details class="detections" id="detected-sources" ref={sourceDetails}>
            <summary>Detected sources ({sources().length})</summary>
            <p class="term-label">
              Detection metrics{" "}
              <TermHelp term="detection metrics">
                Peak SNR compares the signal at the source center, after
                background subtraction, with estimated noise. Gaia DR3 lists
                nearby catalog sources, which can include chance alignments.
              </TermHelp>
            </p>
            <p class="evidence-export">
              <a
                href={evidence()}
                download={`${observation().id}-evidence.json`}
              >
                <Download aria-hidden="true" /> Export detections and provenance
              </a>
            </p>
            <Show
              when={sources().length > 0}
              fallback={<p>No sources passed the detection threshold.</p>}
            >
              <div
                class="table-scroll"
                tabindex="0"
                role="region"
                aria-label="Detected sources"
              >
                <table>
                  <caption>Experimental single-exposure detections</caption>
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">RA</th>
                      <th scope="col">Dec</th>
                      <th scope="col">Peak SNR</th>
                      <th scope="col">Gaia DR3 nearby</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={sources()}>
                      {(source, i) => (
                        <tr
                          classList={{
                            "source-selected": selectedSource() === i(),
                          }}
                        >
                          <td>
                            <button
                              class="source-row-button"
                              type="button"
                              aria-pressed={selectedSource() === i()}
                              onClick={() => inspectSource(i())}
                            >
                              {i() + 1}
                            </button>
                          </td>
                          <td>{source.ra.toFixed(5)}°</td>
                          <td>{source.dec.toFixed(5)}°</td>
                          <td>{source.peakSnr.toFixed(1)}</td>
                          <td>
                            <Show
                              when={matches(i())?.length}
                              fallback={
                                matches(i())
                                  ? "No nearby entry"
                                  : "Gaia match unavailable"
                              }
                            >
                              <ul>
                                <For each={matches(i())}>
                                  {(match) => (
                                    <li>
                                      {match.sourceId} ·{" "}
                                      {match.separation.toFixed(2)}″
                                      {match.propagated
                                        ? ""
                                        : " (reference epoch)"}
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </details>
        </section>
      </div>
    </section>
  );
}

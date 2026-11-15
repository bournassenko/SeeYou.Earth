import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

import detections from "../detections.json";
import gaiaMatches from "../gaiaMatches.json";
import observations from "../observations.json";

type Pixel = { x: number; y: number };
type CoordinateGrid = { coordinates: [number, number][][] };

const coordinateFields = [
  {
    id: "ra",
    label: "Right ascension (RA)",
    hint: "0° to less than 360°",
    isValid: (value: number) => value >= 0 && value < 360,
    error: "Enter right ascension from 0 to less than 360.",
  },
  {
    id: "dec",
    label: "Declination (Dec)",
    hint: "−90° to +90°",
    isValid: (value: number) => value >= -90 && value <= 90,
    error: "Enter declination from −90 to 90.",
  },
  {
    id: "fov",
    label: "Field of view",
    hint: "Greater than 0°, up to 180°",
    isValid: (value: number) => value > 0 && value <= 180,
    error: "Enter a field of view greater than 0 and at most 180.",
  },
] as const;

type CoordinateId = (typeof coordinateFields)[number]["id"];
type FieldErrors = Partial<Record<CoordinateId, string>>;

export default function SkyExplorer() {
  const [errors, setErrors] = createSignal<FieldErrors>({});
  const [selection, setSelection] = createSignal<string[]>();
  const [ready, setReady] = createSignal(false);
  const [index, setIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [pixel, setPixel] = createSignal<Pixel>();
  const observation = () => observations[index()]!;
  const sources = () =>
    detections[observation().name as keyof typeof detections];
  const matches = () =>
    gaiaMatches[observation().name as keyof typeof gaiaMatches];
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
    const point = pixel();
    return point && !grid.loading
      ? grid()?.coordinates[point.y]?.[point.x]
      : undefined;
  };

  function step(direction: number) {
    setIndex(
      (current) =>
        (current + direction + observations.length) % observations.length,
    );
    setPixel(undefined);
  }

  createEffect(() => {
    if (playing()) {
      const timer = window.setInterval(() => step(1), 1400);
      onCleanup(() => window.clearInterval(timer));
    }
  });

  function readPointer(
    event: PointerEvent & { currentTarget: HTMLImageElement },
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const { width, height } = observation();
    const x = Math.floor(
      ((event.clientX - bounds.left) / bounds.width) * width,
    );
    const y = Math.floor(
      ((event.clientY - bounds.top) / bounds.height) * height,
    );
    setPixel(
      x >= 0 && y >= 0 && x < width && y < height ? { x, y } : undefined,
    );
  }

  function readKeyboard(event: KeyboardEvent) {
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
    const point = pixel() ?? {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
    };
    setPixel({
      x: Math.min(width - 1, Math.max(0, point.x + offset.x)),
      y: Math.min(height - 1, Math.max(0, point.y + offset.y)),
    });
  }

  const decimalDegrees = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  onMount(() => setReady(true));

  function submitCoordinates(
    event: SubmitEvent & { currentTarget: HTMLFormElement },
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextErrors: FieldErrors = {};
    const coordinates: string[] = [];

    for (const field of coordinateFields) {
      const input = String(formData.get(field.id) ?? "").trim();
      if (!decimalDegrees.test(input) || !field.isValid(Number(input))) {
        nextErrors[field.id] = field.error;
      }
      coordinates.push(input);
    }

    setErrors(nextErrors);

    const firstInvalid = coordinateFields.find((field) => nextErrors[field.id]);
    if (firstInvalid) {
      setSelection(undefined);
      form.querySelector<HTMLInputElement>(`#${firstInvalid.id}`)?.focus();
      return;
    }

    setSelection(coordinates);
  }

  return (
    <section class="explorer" aria-labelledby="explorer-title">
      <div class="explorer-controls">
        <h2 id="explorer-title">Sky Explorer</h2>

        <form noValidate onSubmit={submitCoordinates}>
          <For each={coordinateFields}>
            {(field) => (
              <div class="coordinate-field">
                <label for={field.id}>{field.label}</label>
                <input
                  id={field.id}
                  name={field.id}
                  type="text"
                  inputmode="decimal"
                  required
                  aria-invalid={Boolean(errors()[field.id])}
                  aria-describedby={`${field.id}-hint${errors()[field.id] ? ` ${field.id}-error` : ""}`}
                />
                <small id={`${field.id}-hint`}>{field.hint}</small>
                <Show when={errors()[field.id]}>
                  <span class="field-error" id={`${field.id}-error`}>
                    {errors()[field.id]}
                  </span>
                </Show>
              </div>
            )}
          </For>
          <button type="submit" disabled={!ready()}>
            Set sky region
          </button>
        </form>
      </div>
      <section class="viewer" aria-labelledby="viewer-title">
        <h3 id="viewer-title">Pinwheel Galaxy · M101</h3>
        <figure>
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
          />
          <figcaption>
            <a href={observation().source}>SPHEREx DR1 · IRSA</a>
            <span>
              Detector {observation().detector} · ≈
              {observation().wavelength.toFixed(3)} µm
            </span>
          </figcaption>
        </figure>
        <p id="pixel-position">
          <Show
            when={sky()}
            fallback={
              grid.loading
                ? "Loading coordinates…"
                : grid() === null
                  ? "Coordinates unavailable."
                  : "Point at the image or use the arrow keys for ICRS coordinates."
            }
          >
            {(position) =>
              `RA ${position()[0].toFixed(6)}° · Dec ${position()[1].toFixed(6)}°`
            }
          </Show>
        </p>
        <div class="timeline">
          <label for="observation">Observation (UTC)</label>
          <select
            id="observation"
            value={index()}
            onChange={(event) => {
              setPlaying(false);
              setPixel(undefined);
              setIndex(Number(event.currentTarget.value));
            }}
          >
            <For each={observations}>
              {(entry, i) => (
                <option value={i()}>
                  {entry.date.replace("T", " ").slice(0, 19)}
                </option>
              )}
            </For>
          </select>
          <div class="playback">
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                step(-1);
              }}
            >
              Previous
            </button>
            <button type="button" onClick={() => setPlaying(!playing())}>
              {playing() ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                step(1);
              }}
            >
              Next
            </button>
          </div>
        </div>
        <details class="detections">
          <summary>Detected sources ({sources().length})</summary>
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
                    <th scope="col">RA</th>
                    <th scope="col">Dec</th>
                    <th scope="col">Peak SNR</th>
                    <th scope="col">Gaia DR3 nearby</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={sources()}>
                    {(source, i) => (
                      <tr>
                        <td>{source.ra.toFixed(5)}°</td>
                        <td>{source.dec.toFixed(5)}°</td>
                        <td>{source.peakSnr.toFixed(1)}</td>
                        <td>
                          <Show
                            when={matches()[i()].length}
                            fallback="No nearby entry"
                          >
                            <ul>
                              <For each={matches()[i()]}>
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
        <div role="status" class="viewer-status">
          <Show when={selection()}>
            {(values) => (
              <>
                <p>Entered sky region · image fixed</p>
                <dl aria-label="Entered sky region">
                  <For each={coordinateFields}>
                    {(field, index) => (
                      <div>
                        <dt>{field.label}</dt>
                        <dd>{values()[index()]}°</dd>
                      </div>
                    )}
                  </For>
                </dl>
              </>
            )}
          </Show>
        </div>
      </section>
    </section>
  );
}

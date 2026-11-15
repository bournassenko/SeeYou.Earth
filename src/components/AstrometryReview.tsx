import TermHelp from "./TermHelp";
import Activity from "lucide-solid/icons/activity";
import Download from "lucide-solid/icons/download";
import Archive from "lucide-solid/icons/archive";
import { createSignal, For, onMount, Show } from "solid-js";
import {
  astrometryHeader,
  parseAstrometry,
  reviewAstrometry,
} from "../science/astrometry";

import archived from "../science/archivedAstrometry.json";

type Analysis = {
  measurements: ReturnType<typeof parseAstrometry>;
  result: ReturnType<typeof reviewAstrometry>;
  provenance: string;
};

const format = (value: number) =>
  new Intl.NumberFormat("en", { maximumSignificantDigits: 5 }).format(value);

export default function AstrometryReview(props: { demo?: boolean }) {
  const [ready, setReady] = createSignal(false);
  onMount(() => setReady(true));
  const [csv, setCsv] = createSignal("");
  const [provenance, setProvenance] = createSignal("");
  const [error, setError] = createSignal("");
  const [analysis, setAnalysis] = createSignal<Analysis>();
  const [loadingFile, setLoadingFile] = createSignal(false);
  let fileRequest = 0;

  function editCsv(value: string) {
    setCsv(value);
    setAnalysis(undefined);
    setError("");
  }

  async function loadFile(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const request = ++fileRequest;
    setLoadingFile(true);
    try {
      if (file.size > 64_000) throw new Error("The file exceeds 64 KB.");
      const content = await file.text();
      if (request === fileRequest) editCsv(content);
    } catch (cause) {
      if (request === fileRequest) {
        setError(
          cause instanceof Error ? cause.message : "Could not read the file.",
        );
      }
    } finally {
      if (request === fileRequest) setLoadingFile(false);
    }
  }

  function analyze() {
    setAnalysis(undefined);
    setError("");
    try {
      const measurements = parseAstrometry(csv());
      setAnalysis({
        measurements,
        result: reviewAstrometry(measurements),
        provenance: provenance().trim(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not analyze the measurements.",
      );
    }
  }

  function loadArchivedTrack() {
    editCsv(archived.csv);
    setProvenance(archived.provenance);
    analyze();
  }

  function report(analysis: Analysis) {
    return `data:application/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(
        {
          schema: "seeyou.astrometry-review.v1",
          frame: "ICRS",
          timescale: "UTC",
          provenance: analysis.provenance || null,
          inputUnits: {
            ra: "degree",
            dec: "degree",
            sigma: "arcsecond per axis",
          },
          method:
            "Weighted constant angular velocity in a local gnomonic projection; last time withheld for prediction.",
          assumptions: [
            "Independent isotropic uncertainties supplied by the observer, including any applicable systematic errors.",
            "The fit does not account for parallax, orbital curvature, catalog identification, or correlated errors.",
          ],
          measurements: analysis.measurements.map(
            ({ utc, ra, dec, sigma }) => ({ utc, ra, dec, sigma }),
          ),
          ...analysis.result,
        },
        null,
        2,
      ),
    )}`;
  }

  return (
    <section
      class="astrometry-review"
      aria-labelledby="astrometry-title"
      data-demo-review={props.demo && ready() ? "ready" : undefined}
    >
      <h2 id="astrometry-title" class="term-label">
        Astrometry review{" "}
        <TermHelp term="astrometry">
          Measuring where a source appears on the sky. Comparing positions over
          time helps test whether its apparent motion exceeds measurement noise.
        </TermHelp>
      </h2>
      <p>
        Compare measured sky positions against a fixed position and a
        constant-motion track.
      </p>
      <form
        class="review-form"
        onSubmit={(event) => {
          event.preventDefault();
          analyze();
        }}
      >
        <div class="coordinate-field">
          <div class="term-label">
            <label for="astrometry-csv">Measurements</label>
            <TermHelp term="measurement format">
              An epoch is an observation time. ICRS is the reference frame for
              sky coordinates. One arcsecond is 1/3600 of a degree, and 1σ is
              one standard deviation of position uncertainty.
            </TermHelp>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Import measurements CSV"
            onChange={loadFile}
          />
          <textarea
            id="astrometry-csv"
            rows="4"
            maxlength="64000"
            placeholder={astrometryHeader}
            aria-describedby="astrometry-format"
            value={csv()}
            disabled={loadingFile()}
            onInput={(event) => editCsv(event.currentTarget.value)}
          />
          <small id="astrometry-format">
            3–200 epochs. UTC exposure midpoint, ICRS coordinates in degrees, 1σ
            position uncertainty per axis in arcseconds.
          </small>
        </div>
        <div class="review-options">
          <div class="coordinate-field">
            <label for="astrometry-provenance">
              Observation IDs or source link
            </label>
            <input
              id="astrometry-provenance"
              maxlength="1000"
              value={provenance()}
              onInput={(event) => {
                setProvenance(event.currentTarget.value);
                setAnalysis(undefined);
              }}
            />
          </div>
          <div class="review-actions">
            <button type="submit" disabled={!ready() || loadingFile()}>
              <Activity aria-hidden="true" /> Review track
            </button>
            <button
              class="archived-track"
              type="button"
              disabled={!ready() || loadingFile()}
              onClick={loadArchivedTrack}
            >
              <Archive aria-hidden="true" /> Try archived track
            </button>
          </div>
          <Show when={error()}>
            <p role="alert" class="field-error">
              {error()}
            </p>
          </Show>
        </div>
      </form>

      <Show when={analysis()} keyed>
        {(review) => (
          <div
            class="astrometry-results"
            aria-label="Track diagnostics"
            role="region"
          >
            <div class="astrometry-metrics">
              <div>
                <span>Apparent speed</span>
                <strong>{format(review.result.speedArcsecPerDay)}″/day</strong>
              </div>
              <div>
                <span class="term-label">
                  Position fixed · χ²{" "}
                  <TermHelp term="chi-squared">
                    A measure of disagreement between observed and fitted
                    positions, scaled by the reported uncertainties. Smaller
                    values indicate a closer fit for the same measurements.
                  </TermHelp>
                </span>
                <strong>{format(review.result.stationaryChiSquared)}</strong>
              </div>
              <div>
                <span>Constant motion · χ²</span>
                <strong>{format(review.result.chiSquared)}</strong>
              </div>
              <div>
                <span>Time span</span>
                <strong>{format(review.result.spanDays)} d</strong>
              </div>
            </div>
            <p>
              <span class="term-label">
                Last epoch held out.{" "}
                <TermHelp term="held-out observation">
                  The latest position is excluded from the fit. Its offset
                  measures the sky separation between the predicted and observed
                  positions.
                </TermHelp>
              </span>
              <br />
              Predicted RA {review.result.withheld.predicted.ra.toFixed(6)}° ·
              Dec {review.result.withheld.predicted.dec.toFixed(6)}°.
              <br />
              Offset {format(review.result.withheld.residualArcsec)}″ · Combined
              1σ per axis {format(review.result.withheld.combinedSigmaArcsec)}″.
            </p>
            <details>
              <summary>Residuals ({review.result.residuals.length})</summary>
              <div
                class="table-scroll"
                tabindex="0"
                role="region"
                aria-label="Fit residuals"
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">UTC</th>
                      <th scope="col">East (″)</th>
                      <th scope="col">North (″)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={review.result.residuals}>
                      {(point) => (
                        <tr>
                          <td>
                            <time datetime={point.utc}>{point.utc}</time>
                          </td>
                          <td>{format(point.eastArcsec)}</td>
                          <td>{format(point.northArcsec)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </details>
            <p>
              Local angular fit only. Independent follow-up and catalog checks
              are needed to assess the object's identity.
            </p>
            <a href={report(review)} download="astrometry-review.json">
              <Download aria-hidden="true" /> Export evidence
            </a>
          </div>
        )}
      </Show>
    </section>
  );
}

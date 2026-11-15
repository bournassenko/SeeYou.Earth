import { createMemo, For, Show } from "solid-js";

type Sample = {
  index: number;
  date: string;
  values: [wavelength: number, brightness: number, uncertainty: number] | null;
};

export default function PixelSpectrum(props: {
  samples: Sample[];
  activeIndex: number;
  selectObservation: (index: number) => void;
}) {
  const plot = createMemo(() => {
    const valid = props.samples.flatMap((sample) =>
      sample.values ? [{ ...sample, values: sample.values }] : [],
    );
    if (!valid.length) return undefined;

    const waves = valid.map(({ values }) => values[0]);
    const low = Math.min(...valid.map(({ values }) => values[1] - values[2]));
    const high = Math.max(...valid.map(({ values }) => values[1] + values[2]));
    const waveLow = Math.min(...waves);
    const waveHigh = Math.max(...waves);
    const waveSpan = Math.max(waveHigh - waveLow, 0.001);
    const brightnessSpan = Math.max(high - low, 0.001);
    return {
      waveLow: (waveLow + waveHigh) / 2 - waveSpan / 1.6,
      waveHigh: (waveLow + waveHigh) / 2 + waveSpan / 1.6,
      low: (low + high) / 2 - brightnessSpan / 1.6,
      high: (low + high) / 2 + brightnessSpan / 1.6,
      points: valid.map((sample) => ({
        ...sample,
        x: 50 + ((sample.values[0] - (waveLow + waveHigh) / 2) / waveSpan) * 80,
        y: 50 - ((sample.values[1] - (low + high) / 2) / brightnessSpan) * 80,
        errorHeight: (sample.values[2] / brightnessSpan) * 160,
      })),
    };
  });

  return (
    <section class="pixel-spectrum" aria-label="Pinned pixel spectrum">
      <h4>Pixel spectrum</h4>
      <Show
        when={plot()}
        keyed
        fallback={<p>No usable samples at this position.</p>}
      >
        {(chart) => (
          <div class="spectrum-layout">
            <div class="spectrum-figure">
              <span>Brightness (MJy/sr)</span>
              <div class="spectrum-chart">
                <div class="spectrum-ticks">
                  <span>{chart.high.toFixed(3)}</span>
                  <span>{chart.low.toFixed(3)}</span>
                </div>
                <div
                  class="spectrum-plot"
                  role="group"
                  aria-label="Brightness by wavelength"
                >
                  <For each={chart.points}>
                    {(point) => (
                      <div
                        class="spectrum-sample"
                        style={{ left: `${point.x}%`, top: `${point.y}%` }}
                      >
                        <span
                          class="spectrum-uncertainty"
                          aria-hidden="true"
                          style={{ height: `${point.errorHeight}%` }}
                        />
                        <button
                          type="button"
                          aria-label={`View observation on ${point.date}`}
                          aria-pressed={props.activeIndex === point.index}
                          onClick={() => props.selectObservation(point.index)}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div class="spectrum-axis">
                <span>{chart.waveLow.toFixed(3)}</span>
                <span>Wavelength (µm)</span>
                <span>{chart.waveHigh.toFixed(3)}</span>
              </div>
            </div>
            <ul class="spectrum-values">
              <For each={props.samples}>
                {(sample) => (
                  <li
                    classList={{
                      "spectrum-active": props.activeIndex === sample.index,
                    }}
                  >
                    <time datetime={sample.date}>{sample.date}</time>
                    <Show
                      when={sample.values}
                      keyed
                      fallback={<span>No usable sample</span>}
                    >
                      {([wavelength, brightness, uncertainty]) => (
                        <span>
                          {wavelength.toFixed(3)} µm · {brightness.toFixed(3)} ±{" "}
                          {uncertainty.toFixed(3)} MJy/sr
                        </span>
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </Show>
      <small>Separate observation dates · approximate wavelengths</small>
    </section>
  );
}

import LoaderCircle from "lucide-solid/icons/loader-circle";
import { createSignal, onCleanup, onMount, Show } from "solid-js";

export type ArchiveProgress =
  | { type: "search" }
  | { type: "example" }
  | { type: "prepare" }
  | {
      type: "cutouts";
      completed: number;
      usable: number;
      total: number;
      matched: number;
    };

export default function ArchiveLoading(props: {
  heading: string;
  progress: ArchiveProgress;
  startedAt: number;
}) {
  const [elapsed, setElapsed] = createSignal(0);
  onMount(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - props.startedAt) / 1000));
    }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  const status = () => {
    const step = props.progress;
    if (step.type === "example") return "Loading archived observations…";
    if (
      step.type === "prepare" ||
      (step.type === "cutouts" && step.completed === step.total)
    )
      return "Preparing the viewer…";
    if (step.type === "cutouts")
      return "Downloading and aligning FITS cutouts…";
    return "Searching the SPHEREx archive…";
  };

  return (
    <section
      class="viewer archive-loading"
      aria-labelledby="archive-loading-title"
    >
      <header class="viewer-header">
        <h2 id="archive-loading-title">{props.heading}</h2>
      </header>
      <div class="archive-skeleton" aria-hidden="true">
        <div class="archive-skeleton-image"></div>
        <div class="archive-skeleton-controls">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
      <div class="archive-loading-overlay">
        <div>
          <LoaderCircle class="loading-spinner" aria-hidden="true" />
          <strong role="status">{status()}</strong>
          <Show
            when={
              props.progress.type === "cutouts" ? props.progress : undefined
            }
          >
            {(step) => (
              <>
                <small>
                  {step().completed} of {step().total} cutouts processed ·{" "}
                  {step().usable} usable
                </small>
                <small>
                  {step().matched.toLocaleString()} archive products returned
                </small>
              </>
            )}
          </Show>
          <small>{elapsed()}s elapsed</small>
        </div>
      </div>
    </section>
  );
}

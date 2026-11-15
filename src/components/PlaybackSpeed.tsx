import { createUniqueId } from "solid-js";

export default function PlaybackSpeed(props: {
  value: number;
  onChange: (value: number) => void;
}) {
  const id = createUniqueId();
  return (
    <div class="playback-speed">
      <label for={id}>Playback speed</label>
      <output for={id}>{props.value}×</output>
      <input
        id={id}
        type="range"
        min="0.5"
        max="6"
        step="0.5"
        value={props.value}
        aria-valuetext={`${props.value} times normal speed`}
        onInput={(event) => props.onChange(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

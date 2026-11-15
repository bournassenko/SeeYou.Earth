import ChevronsLeftRight from "lucide-solid/icons/chevrons-left-right";

export default function ComparisonDivider(props: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <>
      <span
        class="comparison-divider"
        aria-hidden="true"
        style={{ left: `${props.value}%` }}
      >
        <span>
          <ChevronsLeftRight />
        </span>
      </span>
      <input
        class="comparison-drag"
        id={props.id}
        aria-label="Comparison divider"
        aria-valuetext={`${props.value}% reference image`}
        type="range"
        min="0"
        max="100"
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.valueAsNumber)}
      />
    </>
  );
}

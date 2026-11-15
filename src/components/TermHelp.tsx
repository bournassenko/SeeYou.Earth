import Info from "lucide-solid/icons/info";
import { createSignal, createUniqueId } from "solid-js";

export default function TermHelp(props: { term: string; children: string }) {
  const id = createUniqueId();
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const visible = () => !dismissed() && (hovered() || focused() || expanded());

  return (
    <span
      class="term-help"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          setHovered(true);
          setDismissed(false);
        }
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        class="term-help-trigger"
        type="button"
        aria-label={`About ${props.term}`}
        aria-describedby={id}
        onFocus={(event) => {
          setFocused(event.currentTarget.matches(":focus-visible"));
          setDismissed(false);
        }}
        onBlur={() => {
          setFocused(false);
          setExpanded(false);
        }}
        onClick={() => {
          setDismissed(expanded());
          setExpanded(!expanded());
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && visible()) {
            setDismissed(true);
            setExpanded(false);
            event.stopPropagation();
          }
        }}
      >
        <Info aria-hidden="true" />
      </button>
      <span
        id={id}
        class="term-help-tooltip"
        role="tooltip"
        hidden={!visible()}
      >
        {props.children}
      </span>
    </span>
  );
}

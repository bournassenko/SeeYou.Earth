import { Select } from "@kobalte/core/select";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";

type Option = { value: string; label: string };

export default function SelectField(props: {
  id: string;
  label: string;
  options: Option[];
  value?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select<Option>
      class="select-field"
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={
        props.options.find((option) => option.value === props.value) ?? null
      }
      placeholder={props.placeholder}
      disallowEmptySelection
      sameWidth
      onChange={(option) => {
        if (option) props.onChange(option.value);
      }}
      itemComponent={(item) => (
        <Select.Item item={item.item} class="select-item">
          <Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator>
            <Check aria-hidden="true" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        id={props.id}
        class="select-trigger"
        aria-label={props.label}
      >
        <Select.Value<Option>>
          {(state) => state.selectedOption()?.label}
        </Select.Value>
        <Select.Icon>
          <ChevronDown aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="select-menu">
          <Select.Listbox />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

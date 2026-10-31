import { Icon } from "./Icon";

type Option = { value: string; label: string };

/** One of the design's rounded filter pills. Only ever used inside a GET form. */
export function FilterPill({ name, label, value, icon, options }: {
  name: string; label: string; value?: string; icon: string; options: Option[];
}) {
  return (
    <label className={`filter${value ? " filter--on" : ""}`}>
      <img src={icon} alt="" width={20} height={20} />
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value ?? ""}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="filter__chev" aria-hidden="true"><Icon name="chevron" size={16} /></span>
    </label>
  );
}

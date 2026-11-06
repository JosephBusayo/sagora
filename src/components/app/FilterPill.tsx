import { FilterMenu } from "./FilterMenu";

type Option = { value: string; label: string };

/** One of the design's rounded filter pills. Only ever used inside a GET form. */
export function FilterPill({ name, label, value, icon, options }: {
  name: string; label: string; value?: string; icon: string; options: Option[];
}) {
  return <FilterMenu name={name} label={label} value={value} icon={icon} options={options} />;
}

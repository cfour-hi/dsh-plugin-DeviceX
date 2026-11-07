/** Small banner icon wrapper used by the tab banners. */
import { h } from "../jsx.js";
import { Icon } from "./Icon";

export function spanIcon(name: string) {
  return (
    <span className="dx-bannerIcon">
      <Icon name={name} size={14} />
    </span>
  );
}

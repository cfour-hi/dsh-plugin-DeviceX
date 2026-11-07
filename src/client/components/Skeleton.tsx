/** Loading skeleton grid used by every tab shell. */
import { h } from "../jsx.js";
import { asArray, numOr } from "../helpers.js";

export interface SkeletonProps {
  lines?: string[];
  cards?: number;
}

export function Skeleton(props: SkeletonProps) {
  const lines = asArray(props.lines).length > 0 ? (props.lines as string[]) : ["40", "80", "60", "100"];
  return (
    <div className="dx-skelGrid" aria-hidden="true">
      {Array.from({ length: numOr(props.cards, 3) }).map((_ignored, index) => (
        <div className="dx-skelCard" key={index}>
          <div className="dx-skelLine" data-w="40" />
          <div className="dx-skelLine" data-w="100" data-h="tall" />
          <div style={{ display: "flex", gap: "8px" }}>
            {lines.map((width, lineIndex) => (
              <div key={lineIndex} className="dx-skelLine" data-w={width} style={{ flex: 1 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

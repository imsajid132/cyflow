import type { MutableRefObject } from "react";

interface ConnectorLinksProps {
  /** Bezier path strings, one per link between adjacent bubbles. */
  paths: string[];
  width: number;
  height: number;
  /** Populated with each <path> element for packet geometry. */
  pathRefs: MutableRefObject<(SVGPathElement | null)[]>;
  packetRef: MutableRefObject<SVGCircleElement | null>;
}

/**
 * The ink-black curved links between bubbles, plus the travelling lime packet.
 * Purely presentational — geometry is computed by the Canvas and passed in.
 */
export function ConnectorLinks({ paths, width, height, pathRefs, packetRef }: ConnectorLinksProps) {
  return (
    <svg
      className="links"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          ref={(el) => {
            pathRefs.current[i] = el;
          }}
        />
      ))}
      <circle
        className="packet"
        r={7}
        ref={(el) => {
          packetRef.current = el;
        }}
      />
    </svg>
  );
}

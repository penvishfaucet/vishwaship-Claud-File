/**
 * Colourful flat illustrations for the dashboard analytics cards (Vishwaship's own artwork).
 * Cardboard boxes in warm orange tones with a navy outline, plus blue accents for time / return.
 */
const S = { stroke: "#051C46", strokeWidth: 1.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const C = { top: "#FDB36B", left: "#F08A3C", right: "#D66F2C", tape: "#FFE3C2", inside: "#8A4518" };

/** Closed cardboard box (isometric) drawn in a 40×40 box; place with transform. */
function Box({ t = "", tape = true }: { t?: string; tape?: boolean }) {
  return (
    <g transform={t}>
      <path d="M20 4 L36 11 L20 18 L4 11 Z" fill={C.top} {...S} />
      <path d="M4 11 L20 18 L20 36 L4 29 Z" fill={C.left} {...S} />
      <path d="M36 11 L20 18 L20 36 L36 29 Z" fill={C.right} {...S} />
      {tape && <path d="M12 7.5 L28 14.5 L28 19 L24.5 20.6 L24.5 16.2 L8.6 9 Z" fill={C.tape} {...S} strokeWidth={1.1} />}
    </g>
  );
}

type P = { size?: number };
const Svg = ({ size = 56, children, label }: P & { children: React.ReactNode; label: string }) => (
  <svg className="dash-ill" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" data-label={label}>{children}</svg>
);

export function IcoNewOrders(p: P) {
  return (
    <Svg {...p} label="New orders">
      <path d="M12 26 L32 17 L52 26 L32 35 Z" fill={C.inside} {...S} />
      <path d="M12 26 L32 17 L27 9 L7 18 Z" fill={C.top} {...S} />
      <path d="M52 26 L32 17 L37 9 L57 18 Z" fill="#F6A04D" {...S} />
      <path d="M12 26 L32 35 L32 58 L12 49 Z" fill={C.left} {...S} />
      <path d="M52 26 L32 35 L32 58 L52 49 Z" fill={C.right} {...S} />
      <path d="M12 26 L4 34 L24 43 L32 35 Z" fill={C.top} {...S} />
      <path d="M52 26 L60 34 L40 43 L32 35 Z" fill="#F6A04D" {...S} />
      <path d="M15 42 L24 46 L24 52 L15 48 Z" fill="#fff" {...S} strokeWidth={1.1} />
    </Svg>
  );
}

export function IcoCourierAssigned(p: P) {
  return (
    <Svg {...p} label="Courier assigned">
      <Box t="translate(4 6) scale(1.4)" />
      <path d="M12 38 L22 42.5 L22 50.5 L12 46 Z" fill="#fff" {...S} strokeWidth={1.2} />
      <path d="M14 42 L20 44.7 M14 45 L18.5 47" stroke="#051C46" strokeWidth={1.1} strokeLinecap="round" />
      <circle cx="49" cy="46" r="8" fill="#22A06B" {...S} />
      <path d="M45.2 46.2 L48 49 L53 43.6" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IcoScheduled(p: P) {
  return (
    <Svg {...p} label="Pickup scheduled">
      <Box t="translate(10 2) scale(1.35)" />
      <circle cx="22" cy="44" r="12" fill="#3B8CF2" {...S} />
      <circle cx="22" cy="44" r="8.6" fill="#fff" {...S} strokeWidth={1.1} />
      <path d="M22 39 L22 44 L25.5 46.2" fill="none" stroke="#051C46" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M19.5 30.5 h5 M22 30.5 v2" stroke="#051C46" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M3 41 h4 M2 45 h5 M4 49 h3" stroke="#3B8CF2" strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function IcoAllOrders(p: P) {
  return (
    <Svg {...p} label="All orders">
      <Box t="translate(2 28) scale(0.85)" />
      <Box t="translate(29 28) scale(0.85)" />
      <Box t="translate(15.5 6) scale(0.85)" />
    </Svg>
  );
}

export function IcoReturns(p: P) {
  return (
    <Svg {...p} label="Customer returns">
      <Box t="translate(12 2) scale(1.3)" />
      <circle cx="17" cy="47" r="12" fill="#3B8CF2" {...S} />
      <path d="M22.5 49.5 a6 6 0 1 1 -1.2 -7.6" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M22.6 37.8 L21.6 42.4 L17.2 41.4" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IcoRto(p: P) {
  return (
    <Svg {...p} label="Return to origin">
      <path d="M32 6 a26 26 0 1 1 -22.5 13" fill="none" stroke="#051C46" strokeWidth={6.5} strokeLinecap="round" />
      <path d="M32 6 a26 26 0 1 1 -22.5 13" fill="none" stroke="#7C6CF2" strokeWidth={3.8} strokeLinecap="round" />
      <path d="M3.5 13.5 L9.8 19.6 L16.8 15.4" fill="none" stroke="#051C46" strokeWidth={6.2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 13.5 L9.8 19.6 L16.8 15.4" fill="none" stroke="#7C6CF2" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
      <Box t="translate(17 17) scale(0.78)" />
    </Svg>
  );
}

export const DASH_ICONS = {
  new: IcoNewOrders, assigned: IcoCourierAssigned, scheduled: IcoScheduled, all: IcoAllOrders, returns: IcoReturns, rto: IcoRto,
} as const;

/**
 * Hero underline: a delivery bike rides along the orange line and the road is drawn behind it, then the
 * scene fades and repeats. Pure SVG (SMIL), no JS. Visitors who prefer reduced motion get the plain line.
 */
const ROAD = "M6 30 C 120 14, 280 14, 394 28";
const CYCLE = "6s";

export function BikeRoad() {
  return (
    <>
      <svg className="v4-road anim" viewBox="0 0 400 40" aria-hidden="true" focusable="false">
        <path id="v4-road-path" d={ROAD} fill="none" stroke="#f0712c" strokeWidth="4" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset="1">
          <animate attributeName="stroke-dashoffset" values="1;0;0;0" keyTimes="0;0.6;0.9;1" dur={CYCLE} begin="0.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.86;0.96;1" dur={CYCLE} begin="0.8s" repeatCount="indefinite" />
        </path>
        <g opacity="0">
          <animateMotion dur={CYCLE} begin="0.8s" repeatCount="indefinite" rotate="auto" calcMode="linear" keyPoints="0;1;1" keyTimes="0;0.6;1">
            <mpath href="#v4-road-path" />
          </animateMotion>
          <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.86;0.96;1" dur={CYCLE} begin="0.8s" repeatCount="indefinite" />
          {/* bike drawn facing right, wheels resting on the road (origin = road point) */}
          <g transform="translate(-28,-31) scale(1.35)">
            <rect x="3" y="4" width="10" height="8" rx="1.5" fill="#f0712c" stroke="#0b1f3a" strokeWidth="1.4" />
            <path d="M8 18 L15 11 L27 11 L33 18" fill="none" stroke="#0b1f3a" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
            <path d="M15 11 L27 11 L25 8 L17 8 Z" fill="#E0550B" />
            <path d="M27 11 L30 5 L33 5" fill="none" stroke="#0b1f3a" strokeWidth="2" strokeLinecap="round" />
            <circle cx="21" cy="0" r="2.8" fill="#0b1f3a" />
            <path d="M20.5 3 L18.5 8.5 M20 4.5 L28 5.5" fill="none" stroke="#0b1f3a" strokeWidth="2" strokeLinecap="round" />
            {[8, 33].map((cx) => (
              <g key={cx}>
                <circle cx={cx} cy="18" r="5.2" fill="#fff" stroke="#0b1f3a" strokeWidth="2.4" />
                <g>
                  <path d={`M${cx - 3.6} 18 H${cx + 3.6} M${cx} 14.4 V21.6`} stroke="#0b1f3a" strokeWidth="1.2" />
                  <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} 18`} to={`360 ${cx} 18`} dur="0.45s" repeatCount="indefinite" />
                </g>
              </g>
            ))}
          </g>
        </g>
      </svg>
      <svg className="v4-road still" viewBox="0 0 400 40" aria-hidden="true" focusable="false">
        <path d={ROAD} fill="none" stroke="#f0712c" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </>
  );
}

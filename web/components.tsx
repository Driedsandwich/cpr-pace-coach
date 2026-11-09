import type { ReactNode } from "react";
import type { Landmark } from "../src/detector";
import { PRACTICE_NOTICE } from "../src/session";
import { downloadResult, type ExportResult } from "./runtime";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    pulse: <path d="M2 12h5l3-8 5 16 3-8h4" />,
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    play: <path d="m9 5 11 7-11 7Z" />,
    camera: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="3" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v5l3 2M9 2h6M12 2v3" />
      </>
    ),
    pause: (
      <>
        <path d="M8 5v14M16 5v14" strokeWidth="4" />
      </>
    ),
    stop: (
      <rect
        x="6"
        y="6"
        width="12"
        height="12"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    ),
    sound: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5Zm4 4q4 4 0 8m3-11q7 7 0 14" />
      </>
    ),
    beat: (
      <>
        <path d="m8 3-5 18h18L16 3ZM9 14l7-8M8 18h8" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    code: (
      <>
        <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-11v1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.pulse}
    </svg>
  );
}
const point = (value: number, radius: number) => {
  const angle = ((135 + ((value - 60) / 100) * 270) * Math.PI) / 180;
  return {
    x: 260 + radius * Math.cos(angle),
    y: 260 + radius * Math.sin(angle),
  };
};
const arc = (from: number, to: number, radius: number) => {
  const a = point(from, radius),
    b = point(to, radius);
  return `M${a.x},${a.y} A${radius},${radius} 0 ${to - from > 66.66 ? 1 : 0} 1 ${b.x},${b.y}`;
};
export function Gauge({
  rate,
  label,
  preview = false,
}: {
  rate: number | null;
  label: string;
  preview?: boolean;
}) {
  const marker =
    rate === null ? null : point(Math.max(60, Math.min(160, rate)), 217);
  return (
    <div
      className={`gauge ${preview ? "gauge-preview" : ""}`}
      role="img"
      aria-label={`${rate === null ? "Rate unavailable" : `${Math.round(rate)} compressions per minute`}. ${label}. Target 100 to 120 per minute.`}
    >
      <svg viewBox="0 0 520 520" aria-hidden="true">
        <circle
          cx="260"
          cy="260"
          r="217"
          fill="none"
          stroke="var(--border)"
          strokeWidth="9"
        />
        <path
          d={arc(100, 120, 217)}
          stroke="var(--accent)"
          strokeWidth="13"
          fill="none"
        />
        {Array.from({ length: 51 }, (_, i) => {
          const value = 60 + i * 2,
            major = i % 5 === 0,
            a = point(value, 196),
            b = point(value, major ? 181 : 189),
            text = point(value, 247);
          return (
            <g key={value}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={major ? "var(--secondary)" : "var(--border)"}
                strokeWidth={major ? 1.6 : 1}
              />
              {major && (
                <text
                  x={text.x}
                  y={text.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="18"
                  fill="var(--secondary)"
                >
                  {value}
                </text>
              )}
            </g>
          );
        })}
        {marker && (
          <>
            <circle
              cx={marker.x}
              cy={marker.y}
              r="12"
              fill="var(--surface)"
              stroke="var(--accent)"
              strokeWidth="4"
            />
            <circle cx={marker.x} cy={marker.y} r="4" fill="var(--accent)" />
          </>
        )}
      </svg>
      <div className="gauge-reading">
        <span className="gauge-eyebrow">
          {preview ? "YOUR PRACTICE TARGET" : "COMPRESSION RATE"}
        </span>
        <strong>{rate === null ? "—" : Math.round(rate)}</strong>
        <span className="rate-unit">/min</span>
        <span className="target-label">Target 100–120</span>
        <b className="rate-status">{label}</b>
      </div>
      <span className="gauge-bottom">
        {preview
          ? "Two minutes. One steady rhythm."
          : "Estimated from wrist motion"}
      </span>
    </div>
  );
}
export function PosePreview({
  landmarks,
  missing,
  large = false,
}: {
  landmarks: readonly Landmark[];
  missing?: boolean;
  large?: boolean;
}) {
  const fallback: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
  }));
  [11, 12, 13, 14, 15, 16].forEach((id, i) => {
    fallback[id] = {
      x: i % 2 ? 0.65 : 0.35,
      y: 0.2 + Math.floor(i / 2) * 0.28,
    };
  });
  const points = landmarks.length ? landmarks : fallback;
  const p = (id: number) => ({
    x: (points[id]?.x ?? 0.5) * 240,
    y: (points[id]?.y ?? 0.5) * 180,
  });
  return (
    <div className={`pose-grid ${large ? "large" : ""}`}>
      <svg
        viewBox="0 0 240 180"
        role="img"
        aria-label={
          missing
            ? "Pose unavailable. Reposition to show both arms."
            : "Shoulder, elbow and wrist landmark preview"
        }
      >
        <rect
          x="48"
          y="145"
          width="144"
          height="18"
          rx="4"
          fill="var(--surface)"
          stroke="#9ca3ad"
          strokeWidth="1.3"
        />
        <g opacity={missing ? 0.25 : 1}>
          {[
            [11, 12],
            [11, 13],
            [13, 15],
            [12, 14],
            [14, 16],
          ].map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={p(a!).x}
              y1={p(a!).y}
              x2={p(b!).x}
              y2={p(b!).y}
              stroke="#9299a3"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}
          {[11, 12, 13, 14, 15, 16].map((id) => (
            <circle
              key={id}
              cx={p(id).x}
              cy={p(id).y}
              r="4.5"
              fill="var(--accent)"
            />
          ))}
        </g>
      </svg>
      {missing && <span className="pose-unavailable">Waiting for pose</span>}
    </div>
  );
}
export function SetupDiagram() {
  return (
    <svg
      className="setup-diagram"
      viewBox="0 0 480 260"
      role="img"
      aria-label="Place a stable camera to your side, slightly angled so both shoulders, elbows and wrists are visible. Practice on a cushion or manikin, never a person."
    >
      <defs>
        <pattern
          id="setup-grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <path d="M24 0H0V24" fill="none" stroke="#D8DDE3" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="480" height="260" fill="url(#setup-grid)" rx="12" />
      <path d="m96 105 190-65v157L96 135Z" fill="#FBECEF" opacity="0.8" />
      <rect
        x="47"
        y="99"
        width="48"
        height="34"
        rx="6"
        fill="white"
        stroke="#59616D"
        strokeWidth="2"
      />
      <circle
        cx="73"
        cy="116"
        r="8"
        fill="none"
        stroke="#C9364F"
        strokeWidth="2"
      />
      <path
        d="M71 134v65m0-20-20 26m20-26 20 26"
        stroke="#59616D"
        strokeWidth="2"
        fill="none"
      />
      <circle
        cx="312"
        cy="50"
        r="15"
        fill="white"
        stroke="#9299a3"
        strokeWidth="3"
      />
      <path
        d="m300 74-59 52 3 74h60m-5-126 17 53 10 69m-32-118 8 50 11 68"
        stroke="#9299a3"
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {[
        [299, 74],
        [316, 127],
        [326, 196],
        [294, 78],
        [302, 128],
        [313, 196],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill="#C9364F" />
      ))}
      <rect
        x="291"
        y="201"
        width="91"
        height="18"
        rx="6"
        fill="white"
        stroke="#59616D"
        strokeWidth="1.5"
      />
      <text x="36" y="236" fill="#59616D" fontSize="12">
        Stable camera
      </text>
      <text x="293" y="240" fill="#59616D" fontSize="12">
        Cushion or manikin
      </text>
      <path d="M352 84h69M347 136h74" stroke="#C9364F" strokeWidth="1" />
      <text x="359" y="74" fill="#C9364F" fontSize="11">
        Both arms visible
      </text>
    </svg>
  );
}
export function AgentAccess({ result }: { result: ExportResult | null }) {
  return (
    <details className="agent-access">
      <summary>
        <span>
          <Icon name="code" size={18} /> For AI agents{" "}
          <span className="agent-sub">/ Export JSON</span>
        </span>
        <span aria-hidden="true">+</span>
      </summary>
      <div className="agent-content">
        <div>
          <h3>Your practice, in a portable format.</h3>
          <p>
            Download a summary, then choose whether to share it with an AI
            agent. Nothing is sent automatically. Video and pose coordinates are
            never included.
          </p>
          <button
            className="button primary"
            disabled={!result}
            onClick={() => result && downloadResult(result)}
          >
            <Icon name="download" /> Export JSON
          </button>
          {!result && <small>Available after you end a practice.</small>}
        </div>
        <div>
          <h3>Local MCP tools</h3>
          <p>
            <code>summarize_session</code> gives a summary and next practice
            goals. Pass <code>{'{ "session": export.session }'}</code>.
          </p>
          <p>
            <code>compare_sessions</code> compares two summaries. Pass{" "}
            <code>{'{ "before": a.session, "after": b.session }'}</code>.
          </p>
          <p>
            <a
              href={`${import.meta.env.BASE_URL}schema/practice-export.schema.json`}
              target="_blank"
              rel="noreferrer"
            >
              Export schema ↗
            </a>
            <span className="link-divider">/</span>
            <a
              href={`${import.meta.env.BASE_URL}schema/session.schema.json`}
              target="_blank"
              rel="noreferrer"
            >
              Session schema ↗
            </a>
          </p>
          <small>
            The separate local MCP server uses stdio. Your AI client may have
            its own sharing policy.
          </small>
        </div>
      </div>
    </details>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <p className="practice-notice">
        <Icon name="info" size={18} />
        <span>{PRACTICE_NOTICE}</span>
      </p>
      <div className="footer-notes">
        <span>
          Depth is not measured: a single camera cannot reliably estimate it.
        </span>
        <span>
          Adult rate target:{" "}
          <a
            href="https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-basic-life-support"
            target="_blank"
            rel="noreferrer"
          >
            AHA 2025 ↗
          </a>
          <span className="link-divider">·</span>
          <a
            href="https://www.erc.edu/media/wrhj5sye/gl2025-04-bls-e.pdf"
            target="_blank"
            rel="noreferrer"
          >
            ERC 2025 ↗
          </a>
        </span>
      </div>
    </footer>
  );
}

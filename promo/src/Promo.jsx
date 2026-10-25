import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing, random } from 'remotion';
import { C, DISPLAY, LABEL, gradText, loadFonts } from './theme.js';

loadFonts();

// ---------------------------------------------------------------- timeline (30 fps)
const T = {
  title: [0, 66],
  hook: [66, 126],
  happy: [126, 210],
  dinner: [210, 288],
  nap: [288, 378],
  demo: [378, 462],
  board: [462, 528],
  end: [528, 600],
};
export const PROMO_FRAMES = 600;
const CUTS = Object.values(T).map(([a]) => a).filter((f) => f > 0);

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

// Decaying camera shake that kicks in at `at` (local frames).
function shake(frame, at, power = 18, length = 10) {
  const t = frame - at;
  if (t < 0 || t > length) return 'translate(0px, 0px)';
  const k = power * (1 - t / length);
  return `translate(${(random(`sx${at}${t}`) - 0.5) * k}px, ${(random(`sy${at}${t}`) - 0.5) * k}px)`;
}

// Text that slams in from big to normal size.
function useSlam(at, { from = 2.6, damping = 12 } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping, stiffness: 220, mass: 0.6 } });
  return { scale: interpolate(s, [0, 1], [from, 1]), opacity: interpolate(frame - at, [0, 3], [0, 1], clamp) };
}

// ---------------------------------------------------------------- background
const Backdrop = () => {
  const frame = useCurrentFrame();
  const flicker = 0.85 + 0.15 * Math.sin(frame / 3.1) * Math.sin(frame / 7.3);
  const beamIn = interpolate(frame, [0, 10], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(70% 40% at 0% 0%, rgba(227,178,92,${0.32 * flicker}), transparent 65%), radial-gradient(70% 40% at 100% 0%, rgba(213,216,221,${0.2 * flicker}), transparent 65%), radial-gradient(80% 30% at 50% 105%, rgba(227,178,92,0.22), transparent 70%)` }} />
      {[{ x: 110, c: '255,226,166' }, { x: 970, c: '255,255,255' }].map((b, i) => (
        <div key={i} style={{ position: 'absolute', left: b.x, top: -100, width: 6, height: 1500, opacity: beamIn * flicker, background: `linear-gradient(180deg, transparent, rgba(${b.c},0.95) 25%, rgba(${b.c},0.15) 85%, transparent)`, boxShadow: `0 0 40px 10px rgba(${b.c},0.35)` }} />
      ))}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75) 100%)' }} />
      <svg width="1080" height="1920" style={{ position: 'absolute', inset: 0, opacity: 0.09, mixBlendMode: 'overlay' }}>
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 12} /></filter>
        <rect width="1080" height="1920" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};

const Flash = () => {
  const frame = useCurrentFrame();
  let o = 0;
  for (const c of CUTS) if (frame >= c) o = Math.max(o, interpolate(frame - c, [0, 1, 6], [0.9, 0.7, 0], clamp));
  return <AbsoluteFill style={{ background: '#fff1d0', opacity: o, pointerEvents: 'none' }} />;
};

// ---------------------------------------------------------------- shared bits
const Kicker = ({ children, color = C.gold, size = 40, spacing = '0.32em', style }) => (
  <div style={{ fontFamily: LABEL, fontWeight: 600, fontSize: size, letterSpacing: spacing, textTransform: 'uppercase', color, ...style }}>{children}</div>
);

const Bolt = ({ size = 360, opacity = 1 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute', opacity, filter: 'drop-shadow(0 0 30px rgba(255,190,90,0.9))' }}>
    <defs><linearGradient id="bolt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff6dc" /><stop offset="0.5" stopColor="#e3b25c" /><stop offset="1" stopColor="#a8742a" /></linearGradient></defs>
    <path d="M58 2 L22 56 L46 56 L36 98 L80 38 L54 38 Z" fill="url(#bolt)" />
  </svg>
);

const TICKER = 'HAPPY HOUR RUNS DRY  YES 94¢ ▲72   •   DINNER BY 7:30  NO 97¢ ▲49   •   FIRST NAP  “BRB, CHARGER” 100¢   •   DEMO CRASHES  YES 99¢ ▲28   •   CHAMPIONS 54¢   •   CHALLENGERS 46¢   •   ';
const Ticker = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 70, height: 84, borderTop: '2px solid rgba(227,178,92,0.45)', borderBottom: '2px solid rgba(227,178,92,0.45)', background: 'rgba(7,6,5,0.85)', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
      <div style={{ whiteSpace: 'nowrap', fontFamily: LABEL, fontWeight: 600, fontSize: 36, letterSpacing: '0.08em', color: C.text2, transform: `translateX(${-(frame * 9) % 2400}px)` }}>
        {TICKER}{TICKER}{TICKER}
      </div>
    </div>
  );
};

// Clock that fast-forwards between two times, e.g. 5:00 PM -> 6:41 PM.
const fmtClock = (mins) => { const h24 = Math.floor(mins / 60) % 24; const m = Math.floor(mins % 60); const h = ((h24 + 11) % 12) + 1; return `${h}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`; };
const Clock = ({ day, from, to, label, dur = 22 }) => {
  const frame = useCurrentFrame();
  const mins = interpolate(frame, [2, dur], [from, to], { ...clamp, easing: Easing.out(Easing.cubic) });
  const slide = interpolate(frame, [0, 8], [-80, 0], { ...clamp, easing: ease });
  return (
    <div style={{ position: 'absolute', top: 150, left: 0, right: 0, textAlign: 'center', transform: `translateY(${slide}px)`, opacity: interpolate(frame, [0, 4], [0, 1], clamp) }}>
      <Kicker size={38} color={C.text2}>{day}</Kicker>
      <div style={{ fontFamily: DISPLAY, fontSize: 190, lineHeight: 1, letterSpacing: '0.01em', ...gradText(C.goldGrad), fontVariantNumeric: 'tabular-nums' }}>{fmtClock(mins)}</div>
      <Kicker size={34} spacing="0.4em" style={{ marginTop: 10 }}>{label}</Kicker>
    </div>
  );
};

// Price series that wanders from p0 to p1 and gets revealed over time.
function series(seed, p0, p1, n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const base = p0 + (p1 - p0) * Math.pow(t, 1.6);
    const wobble = (random(`${seed}${i}`) - 0.5) * 0.14 * (1 - t);
    return Math.min(0.99, Math.max(0.02, base + wobble));
  });
}
const Spark = ({ seed, p0, p1, progress, color, w = 820, h = 220 }) => {
  const pts = series(seed, p0, p1);
  const n = Math.max(2, Math.round(progress * pts.length));
  const d = pts.slice(0, n).map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * w},${(1 - p) * h}`).join(' ');
  const last = pts[n - 1];
  return (
    <svg width={w} height={h + 20} style={{ overflow: 'visible' }}>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={(1 - g) * h} y2={(1 - g) * h} stroke="#25221d" strokeWidth="2" />)}
      <path d={d} fill="none" stroke={color} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 12px ${color})` }} />
      <circle cx={((n - 1) / (pts.length - 1)) * w} cy={(1 - last) * h} r="12" fill={color} stroke={C.card} strokeWidth="5" />
    </svg>
  );
};

const Stamp = ({ at, text, color = C.gold, top = 250 }) => {
  const frame = useCurrentFrame();
  const { scale, opacity } = useSlam(at, { from: 3, damping: 10 });
  if (frame < at) return null;
  return (
    <div style={{ position: 'absolute', right: 40, top, transform: `rotate(-9deg) scale(${scale})`, opacity, border: `8px solid ${color}`, color, borderRadius: 20, padding: '10px 26px', fontFamily: DISPLAY, fontSize: 70, letterSpacing: '0.04em', background: 'rgba(7,6,5,0.82)', boxShadow: `0 0 40px ${color}55` }}>{text}</div>
  );
};

const Caption = ({ at, children, sub }) => {
  const frame = useCurrentFrame();
  const { scale, opacity } = useSlam(at, { from: 1.8, damping: 13 });
  if (frame < at) return null;
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, top: 1480, textAlign: 'center', transform: `scale(${scale})`, opacity }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 96, lineHeight: 1.02, color: C.text, textShadow: '0 6px 30px rgba(0,0,0,0.8)' }}>{children}</div>
      {sub && <div style={{ fontFamily: LABEL, fontWeight: 500, fontSize: 40, letterSpacing: '0.12em', color: C.text2, marginTop: 14 }}>{sub}</div>}
    </div>
  );
};

const Card = ({ children, glitch = 0 }) => {
  const frame = useCurrentFrame();
  const pop = spring({ frame: frame - 4, fps: 30, config: { damping: 14, stiffness: 160 } });
  const gx = glitch ? (random(`g${frame}`) - 0.5) * 40 * glitch : 0;
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, top: 560, transform: `translate(${gx}px, ${interpolate(pop, [0, 1], [120, 0])}px)`, opacity: pop, background: `linear-gradient(160deg, rgba(227,178,92,0.10), ${C.card} 40%)`, border: '3px solid rgba(227,178,92,0.42)', borderRadius: 40, padding: 48, boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(227,178,92,0.12)', filter: glitch ? `drop-shadow(${8 * glitch}px 0 0 rgba(255,60,60,0.7)) drop-shadow(${-8 * glitch}px 0 0 rgba(60,200,255,0.7))` : undefined }}>
      {children}
    </div>
  );
};

const CardTitle = ({ tag, children }) => (
  <>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18 }}>
      <span style={{ fontFamily: LABEL, fontWeight: 600, fontSize: 30, letterSpacing: '0.1em', color: '#ff6b6b' }}>● LIVE</span>
      <span style={{ fontFamily: LABEL, fontWeight: 600, fontSize: 28, letterSpacing: '0.12em', color: C.gold, background: 'rgba(227,178,92,0.14)', padding: '4px 16px', borderRadius: 999 }}>{tag}</span>
    </div>
    <div style={{ fontFamily: LABEL, fontWeight: 600, fontSize: 62, lineHeight: 1.12, color: C.text, marginBottom: 26 }}>{children}</div>
  </>
);

const YesNo = ({ yes, highlight }) => {
  const box = (label, p, on, grad, col) => (
    <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 30px', borderRadius: 22, background: on ? `${col}26` : 'rgba(255,255,255,0.04)', boxShadow: on ? `inset 0 0 0 3px ${col}` : 'inset 0 0 0 2px rgba(255,255,255,0.08)' }}>
      <span style={{ fontFamily: LABEL, fontWeight: 600, fontSize: 46, color: col }}>{label}</span>
      <span style={{ fontFamily: DISPLAY, fontSize: 76, ...gradText(grad), fontVariantNumeric: 'tabular-nums' }}>{Math.round(p * 100)}¢</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 22, marginTop: 24 }}>
      {box('YES', yes, highlight === 'yes', C.goldGrad, C.gold)}
      {box('NO', 1 - yes, highlight === 'no', C.silverGrad, C.silver)}
    </div>
  );
};

// A binary market beat: clock, card with moving price, stamp, punchline.
const BinaryBeat = ({ day, from, to, label, tag, question, seed, y0, y1, winner, stampAt, captionAt, caption, sub, glitchAt }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [8, stampAt], [0.05, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const yes = series(seed, y0, y1)[Math.max(0, Math.round(progress * 39))];
  const glitch = glitchAt ? interpolate(frame, [glitchAt, glitchAt + 2, glitchAt + 10], [0, 1, 0], clamp) : 0;
  return (
    <AbsoluteFill style={{ transform: shake(frame, stampAt, 26) }}>
      <Clock day={day} from={from} to={to} label={label} dur={stampAt} />
      <Card glitch={glitch}>
        <CardTitle tag={tag}>{question}</CardTitle>
        <Spark seed={seed} p0={y0} p1={y1} progress={progress} color={winner === 'yes' ? C.gold : C.silver} />
        <YesNo yes={yes} highlight={frame >= stampAt ? winner : null} />
        <Stamp at={stampAt} text={`RESOLVED: ${winner.toUpperCase()}`} color={winner === 'yes' ? C.gold : C.silver} />
      </Card>
      <Caption at={captionAt} sub={sub}>{caption}</Caption>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- scenes
const TitleScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const left = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 140 } });
  const right = spring({ frame: frame - 9, fps, config: { damping: 16, stiffness: 140 } });
  const vs = useSlam(18, { from: 4, damping: 9 });
  const flash = interpolate(frame, [18, 20, 28], [0, 0.85, 0], clamp);
  return (
    <AbsoluteFill style={{ transform: shake(frame, 18, 34, 12) }}>
      <div style={{ position: 'absolute', top: 330, left: 0, right: 0, textAlign: 'center', opacity: interpolate(frame, [2, 10], [0, 1], clamp) }}>
        <Kicker size={36} spacing="0.5em" color={C.text2}>Gauntlet presents</Kicker>
      </div>
      <div style={{ position: 'absolute', top: 560, width: '100%', textAlign: 'center', transform: `translateX(${interpolate(left, [0, 1], [-1100, 0])}px)` }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 196, lineHeight: 1, ...gradText(C.goldGrad) }}>CHAMPIONS</span>
      </div>
      <div style={{ position: 'absolute', top: 790, width: '100%', height: 260, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {frame >= 18 && <Bolt size={340} opacity={vs.opacity * 0.9} />}
        <span style={{ position: 'relative', fontFamily: DISPLAY, fontSize: 200, transform: `scale(${vs.scale}) skewX(-12deg)`, opacity: vs.opacity, ...gradText(C.goldGrad), filter: 'drop-shadow(0 0 26px rgba(255,190,90,0.9))' }}>VS.</span>
      </div>
      <div style={{ position: 'absolute', top: 1060, width: '100%', textAlign: 'center', transform: `translateX(${interpolate(right, [0, 1], [1100, 0])}px)` }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 180, lineHeight: 1, ...gradText(C.silverGrad) }}>CHALLENGERS</span>
      </div>
      <div style={{ position: 'absolute', top: 1320, left: 0, right: 0, textAlign: 'center', opacity: interpolate(frame, [30, 40], [0, 1], clamp), transform: `translateY(${interpolate(frame, [30, 40], [30, 0], clamp)}px)` }}>
        <Kicker size={44} spacing="0.3em">24 hours. Two sides.</Kicker>
        <Kicker size={44} spacing="0.3em" color={C.text}>One prediction market.</Kicker>
      </div>
      <AbsoluteFill style={{ background: '#fff1d0', opacity: flash }} />
    </AbsoluteFill>
  );
};

const HookScene = () => {
  const frame = useCurrentFrame();
  const a = useSlam(2); const b = useSlam(10); const c = useSlam(18, { from: 3 });
  const badge = interpolate(frame, [30, 40], [80, 0], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ transform: shake(frame, 18, 30) }}>
      <div style={{ position: 'absolute', top: 470, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{ transform: `scale(${a.scale})`, opacity: a.opacity }}><Kicker size={58} spacing="0.3em">New this year:</Kicker></div>
        <div style={{ fontFamily: DISPLAY, fontSize: 250, lineHeight: 0.95, color: C.text, marginTop: 30, transform: `scale(${b.scale})`, opacity: b.opacity }}>BET ON</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 210, lineHeight: 1, transform: `scale(${c.scale}) rotate(-3deg)`, opacity: c.opacity, ...gradText(C.goldGrad), filter: 'drop-shadow(0 0 30px rgba(227,178,92,0.5))' }}>EVERYTHING.</div>
      </div>
      <div style={{ position: 'absolute', top: 1180, left: 90, right: 90, textAlign: 'center', transform: `translateY(${badge}px)`, opacity: interpolate(frame, [30, 36], [0, 1], clamp), border: '3px solid rgba(227,178,92,0.5)', borderRadius: 999, padding: '26px 30px', background: 'rgba(0,0,0,0.5)' }}>
        <div style={{ fontFamily: LABEL, fontWeight: 600, fontSize: 44, letterSpacing: '0.08em', color: C.text }}><span style={gradText(C.goldGrad)}>$1,000</span> FAKE MONEY</div>
        <div style={{ fontFamily: LABEL, fontWeight: 500, fontSize: 36, letterSpacing: '0.12em', color: C.text2, marginTop: 4 }}>100% REAL BRAGGING RIGHTS</div>
      </div>
    </AbsoluteFill>
  );
};

const NapScene = () => {
  const frame = useCurrentFrame();
  const stampAt = 52;
  const p = interpolate(frame, [8, stampAt], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const rows = [
    { name: '“brb, grabbing my charger”', a: 0.18, b: 1, color: C.gold },
    { name: 'Nobody. We are machines.', a: 0.52, b: 0, color: C.silver },
    { name: 'The team lead', a: 0.3, b: 0, color: C.bronze },
  ];
  return (
    <AbsoluteFill style={{ transform: shake(frame, stampAt, 26) }}>
      <Clock day="Saturday" from={108} to={192} label="Deep in the night" dur={stampAt} />
      <Card>
        <CardTitle tag="PEOPLE">Who leaves first for a nap?</CardTitle>
        {rows.map((r, i) => {
          const v = r.a + (r.b - r.a) * p;
          return (
            <div key={i} style={{ marginTop: i ? 26 : 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: LABEL, fontWeight: 600, fontSize: 44, color: C.text }}>{r.name}</span>
                <span style={{ fontFamily: DISPLAY, fontSize: 70, color: r.color, fontVariantNumeric: 'tabular-nums' }}>{Math.round(v * 100)}%</span>
              </div>
              <div style={{ height: 16, borderRadius: 999, background: '#25221d', marginTop: 8, overflow: 'hidden' }}>
                <div style={{ width: `${v * 100}%`, height: '100%', borderRadius: 999, background: r.color, boxShadow: `0 0 18px ${r.color}` }} />
              </div>
            </div>
          );
        })}
        <Stamp at={stampAt} text="RESOLVED" top={300} />
      </Card>
      <Caption at={60} sub="(no charger was found)">GONE 40 MINUTES.</Caption>
    </AbsoluteFill>
  );
};

const BoardScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pod = [
    { rank: 2, h: 330, amt: '$1,842', col: C.silver, grad: C.silverGrad, x: 90, delay: 6 },
    { rank: 1, h: 470, amt: '$2,317', col: C.gold, grad: C.goldGrad, x: 390, delay: 0 },
    { rank: 3, h: 250, amt: '$1,509', col: C.bronze, grad: 'linear-gradient(180deg,#f3c49b,#d5905b,#8c5427)', x: 690, delay: 12 },
  ];
  const you = useSlam(26, { from: 3, damping: 9 });
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 230, left: 0, right: 0, textAlign: 'center' }}>
        <Kicker size={40} spacing="0.4em" color={C.text2}>Saturday · 5:00 PM</Kicker>
        <div style={{ fontFamily: DISPLAY, fontSize: 150, lineHeight: 1, ...gradText(C.goldGrad) }}>THE LEADERBOARD</div>
      </div>
      {pod.map((p) => {
        const s = spring({ frame: frame - p.delay, fps, config: { damping: 15, stiffness: 120 } });
        return (
          <div key={p.rank} style={{ position: 'absolute', left: p.x, width: 300, bottom: 560, height: p.h * s, background: `linear-gradient(180deg, ${p.col}40, ${p.col}10)`, border: `3px solid ${p.col}`, borderBottom: 'none', borderRadius: '24px 24px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 26, overflow: 'visible' }}>
            <div style={{ position: 'absolute', top: -150, width: 120, height: 120, borderRadius: 999, background: p.grad, display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 70, color: '#1c1305', opacity: s, boxShadow: `0 0 30px ${p.col}88` }}>{p.rank === 1 && frame >= 26 ? '★' : '?'}</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 96, ...gradText(p.grad), opacity: s }}>#{p.rank}</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 62, color: C.text, opacity: s }}>{p.amt}</div>
          </div>
        );
      })}
      {frame >= 26 && (
        <div style={{ position: 'absolute', top: 660, left: 390, width: 300, textAlign: 'center', transform: `scale(${you.scale}) rotate(-6deg)`, opacity: you.opacity }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 110, color: C.text, background: '#ff6b6b', padding: '0 26px', borderRadius: 18, boxShadow: '0 10px 40px rgba(255,107,107,0.5)' }}>YOU?</span>
        </div>
      )}
      <Confetti start={26} />
      <div style={{ position: 'absolute', top: 1400, left: 0, right: 0, textAlign: 'center', opacity: interpolate(frame, [34, 42], [0, 1], clamp) }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 92, color: C.text }}>FAKE MONEY.</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 92, ...gradText(C.goldGrad) }}>REAL BRAGGING RIGHTS.</div>
      </div>
    </AbsoluteFill>
  );
};

const Confetti = ({ start }) => {
  const frame = useCurrentFrame();
  const t = frame - start;
  if (t < 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 70 }, (_, i) => {
        const x = random(`cx${i}`) * 1080;
        const vy = 14 + random(`cv${i}`) * 18;
        const y = -60 + t * vy - 200 * random(`cy${i}`);
        const rot = t * (random(`cr${i}`) * 30 - 15);
        const col = [C.gold, C.silver, '#fbe7b5', C.goldDeep][i % 4];
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: 18, height: 34, background: col, transform: `rotate(${rot}deg)`, borderRadius: 4, opacity: 0.95 }} />;
      })}
    </AbsoluteFill>
  );
};

const EndScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lock = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const cta = useSlam(14, { from: 2.4, damping: 10 });
  const glow = 0.6 + 0.4 * Math.sin(frame / 5);
  return (
    <AbsoluteFill style={{ transform: shake(frame, 14, 24) }}>
      <div style={{ position: 'absolute', top: 300, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${interpolate(lock, [0, 1], [0.8, 1])})`, opacity: lock }}>
        <svg width="150" height="150" viewBox="0 0 32 32" style={{ filter: `drop-shadow(0 0 ${30 * glow}px rgba(227,178,92,0.8))` }}>
          <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fbe7b5" /><stop offset=".5" stopColor="#e3b25c" /><stop offset="1" stopColor="#a8742a" /></linearGradient></defs>
          <path d="M4 3h24v17l-12 9-12-9z" fill="url(#sg)" />
          <path d="M11 11h10M11 16h10" stroke="#1c1305" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
        </svg>
        <div style={{ fontFamily: DISPLAY, fontSize: 130, lineHeight: 1, marginTop: 30, ...gradText(C.goldGrad) }}>HACKSTREET BETS</div>
        <Kicker size={36} spacing="0.34em" color={C.text2} style={{ marginTop: 16 }}>The official prediction market</Kicker>
      </div>
      <div style={{ position: 'absolute', top: 820, left: 0, right: 0, textAlign: 'center', transform: `scale(${cta.scale})`, opacity: cta.opacity }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 210, lineHeight: 0.95, color: C.text }}>PLACE YOUR</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 250, lineHeight: 0.95, ...gradText(C.goldGrad), filter: 'drop-shadow(0 0 30px rgba(227,178,92,0.55))' }}>BETS.</div>
      </div>
      <div style={{ position: 'absolute', top: 1360, left: 0, right: 0, textAlign: 'center', opacity: interpolate(frame, [24, 34], [0, 1], clamp) }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 84 }}><span style={gradText(C.goldGrad)}>CHAMPIONS</span> <span style={{ ...gradText(C.goldGrad), display: 'inline-block', transform: 'skewX(-12deg)' }}>VS.</span> <span style={gradText(C.silverGrad)}>CHALLENGERS</span></div>
        <Kicker size={40} spacing="0.26em" style={{ marginTop: 18 }}>Nov 6–7 · Fri 5 PM — Sat 5 PM</Kicker>
        <Kicker size={40} spacing="0.26em" color={C.text} style={{ marginTop: 8 }}>Austin, TX</Kicker>
      </div>
      <div style={{ position: 'absolute', bottom: 120, left: 0, right: 0, textAlign: 'center', opacity: interpolate(frame, [36, 46], [0, 1], clamp) }}>
        <Kicker size={34} spacing="0.2em" color={C.muted}>Link drops at kickoff. Bring your gut feelings.</Kicker>
      </div>
    </AbsoluteFill>
  );
};

const seq = ([a, b]) => ({ from: a, durationInFrames: b - a });

export const Promo = () => {
  const frame = useCurrentFrame();
  const showTicker = frame >= T.hook[0] && frame < T.end[0];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Backdrop />
      <Sequence {...seq(T.title)}><TitleScene /></Sequence>
      <Sequence {...seq(T.hook)}><HookScene /></Sequence>
      <Sequence {...seq(T.happy)}>
        <BinaryBeat day="Friday" from={17 * 60} to={18 * 60 + 41} label="Kickoff happy hour" tag="FOOD" question="Happy hour runs dry before 7 PM?" seed="happy" y0={0.22} y1={0.94} winner="yes" stampAt={50} captionAt={58} caption="BAR: EMPTY. ODDS: CORRECT." />
      </Sequence>
      <Sequence {...seq(T.dinner)}>
        <BinaryBeat day="Friday" from={19 * 60 + 2} to={19 * 60 + 31} label="Dinner watch" tag="FOOD" question="Will dinner arrive before 7:30 PM?" seed="dinner" y0={0.55} y1={0.04} winner="no" stampAt={44} captionAt={52} caption="IT ARRIVED AT 7:31." sub="the market knew" />
      </Sequence>
      <Sequence {...seq(T.nap)}><NapScene /></Sequence>
      <Sequence {...seq(T.demo)}>
        <BinaryBeat day="Saturday" from={16 * 60 + 31} to={16 * 60 + 58} label="Final demos" tag="CHAOS" question="Will a demo crash live on stage?" seed="demo" y0={0.71} y1={0.99} winner="yes" stampAt={50} captionAt={58} caption="“IT WORKED ON MY MACHINE.”" glitchAt={40} />
      </Sequence>
      <Sequence {...seq(T.board)}><BoardScene /></Sequence>
      <Sequence {...seq(T.end)}><EndScene /></Sequence>
      {showTicker && <Ticker />}
      <Flash />
    </AbsoluteFill>
  );
};

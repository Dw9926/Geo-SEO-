import { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

// ————————————————————————————————————————————————
// MAISON — an idle design house
// Wings: Fashion · Automotive · Interiors
// Loop: earn Taste → hire studios → commission Drops →
// complete collections → new Season (prestige)
// ————————————————————————————————————————————————

// storage shim: the game expects an async window.storage API;
// back it with localStorage so saves persist in the browser.
if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      return value == null ? null : { value };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key };
    },
  };
}

const SAVE_KEY = "maison_save_v1";
const TICK_MS = 200;
const OFFLINE_CAP_H = 8;
const OFFLINE_RATE = 0.5;

const INK = "#141412";
const PAPER = "#FAFAF7";
const LINE = "#E3E1DA";
const MUTE = "#8B8B84";
const KLEIN = "#2438E8";

const DIDOT = "'Didot','Bodoni MT','Playfair Display',Georgia,serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

const RARITIES = {
  house:     { label: "House",     color: "#8B8B84", bonus: 0.02, p: 0.55 },
  refined:   { label: "Refined",   color: KLEIN,      bonus: 0.06, p: 0.30 },
  signature: { label: "Signature", color: "#C2361F", bonus: 0.15, p: 0.12 },
  iconic:    { label: "Iconic",    color: "#A8842E", bonus: 0.40, p: 0.03 },
};

const WINGS = [
  {
    id: "fashion", name: "Fashion", unlock: 0,
    studios: [
      { id: "sketch",  name: "Sketch Desk",    cost: 15,      inc: 0.1 },
      { id: "atelier", name: "Atelier",        cost: 120,     inc: 1 },
      { id: "runway",  name: "Runway Show",    cost: 1300,    inc: 9 },
    ],
    collections: [
      { id: "tailoring", name: "Tailoring", items: ["Charcoal Blazer", "Bias-Cut Trouser", "Silk Lapel Coat", "Column Dress"] },
      { id: "street",    name: "Street",    items: ["Oversize Parka", "Cargo Denim", "Chrome Sneaker", "Nylon Crossbody"] },
    ],
  },
  {
    id: "auto", name: "Automotive", unlock: 50_000,
    studios: [
      { id: "clay",   name: "Clay Studio",    cost: 15_000,    inc: 55 },
      { id: "wind",   name: "Wind Tunnel",    cost: 160_000,   inc: 300 },
      { id: "garage", name: "Concept Garage", cost: 1_800_000, inc: 1800 },
    ],
    collections: [
      { id: "tourer",   name: "Grand Tourer", items: ["Fastback Coupe", "V12 Cabriolet", "Shooting Brake", "Monza Prototype"] },
      { id: "electric", name: "Electric",     items: ["Hyper EV", "City Pod", "Solar Roadster", "Silent Sedan"] },
    ],
  },
  {
    id: "interior", name: "Interiors", unlock: 5_000_000,
    studios: [
      { id: "mood",      name: "Mood Board",      cost: 25e6, inc: 9_500 },
      { id: "materials", name: "Material Lab",    cost: 4e8,  inc: 56_000 },
      { id: "penthouse", name: "Penthouse Suite", cost: 6e9,  inc: 320_000 },
    ],
    collections: [
      { id: "modernist", name: "Modernist", items: ["Sculpted Oak Table", "Boucle Lounge Chair", "Travertine Console", "Paper Lantern"] },
      { id: "brutalist", name: "Brutalist", items: ["Concrete Hearth", "Steel Bookwall", "Smoked Glass Bar", "Tatami Loft"] },
    ],
  },
];

const MILESTONES = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12];

const seasonName = (i) => `${i % 2 === 0 ? "SS" : "FW"} ${26 + Math.floor(i / 2)}`;

function fmt(n) {
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  const units = ["k", "M", "B", "T", "Qa", "Qi"];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + units[u];
}

// deterministic swatch gradient from a string
function swatch(id, rarity) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const h1 = h % 360, h2 = (h1 + 40 + (h % 80)) % 360, ang = h % 180;
  const s = rarity === "iconic" ? 62 : rarity === "signature" ? 55 : 42;
  return `linear-gradient(${ang}deg, hsl(${h1} ${s}% 62%), hsl(${h2} ${s - 8}% 40%))`;
}

function rollRarity() {
  // ordered roll: rare first
  let x = Math.random();
  if (x < RARITIES.iconic.p) return "iconic";
  x -= RARITIES.iconic.p;
  if (x < RARITIES.signature.p) return "signature";
  x -= RARITIES.signature.p;
  if (x < RARITIES.refined.p) return "refined";
  return "house";
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const yesterdayStr = () => {
  const d = new Date(Date.now() - 86400_000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const freshState = () => ({
  taste: 0,
  lifetime: 0,
  studios: {},          // studioId -> count
  designs: {},          // "wingId:Item Name" -> rarity key
  drops: 0,
  renown: 0,
  season: 0,
  streak: 1,
  lastDay: todayStr(),
  milestone: 0,         // index of next unclaimed milestone
  savedAt: Date.now(),
  perSecAtSave: 0,
});

export default function Maison() {
  const [game, setGame] = useState(freshState);
  const [loaded, setLoaded] = useState(false);
  const [wing, setWing] = useState("fashion");
  const [reveal, setReveal] = useState(null);   // { name, rarity, wing }
  const [welcome, setWelcome] = useState(null); // { away, earned, streak }
  const [toasts, setToasts] = useState([]);
  const gameRef = useRef(game);
  gameRef.current = game;

  const toast = useCallback((msg) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  // ——— derived economy ———
  const designBonus = Object.values(game.designs).reduce((a, r) => a + (RARITIES[r]?.bonus || 0), 0);
  const completedCollections = WINGS.flatMap((w) =>
    w.collections.filter((c) => c.items.every((it) => game.designs[`${w.id}:${it}`]))
  ).length;
  const collectionMult = Math.pow(1.25, completedCollections);
  const streakMult = 1 + Math.min(game.streak - 1, 10) * 0.02;
  const globalMult = (1 + designBonus) * collectionMult * (1 + game.renown * 0.12) * streakMult;

  const baseInc = WINGS.reduce(
    (sum, w) => sum + w.studios.reduce((s, st) => s + (game.studios[st.id] || 0) * st.inc, 0), 0);
  const perSec = baseInc * globalMult;
  const tapPower = (1 + perSec * 0.08) ;

  const studioCost = (st) => Math.ceil(st.cost * Math.pow(1.15, game.studios[st.id] || 0));
  const dropCost = Math.ceil(400 * Math.pow(1.42, game.drops));

  const nextMilestone = MILESTONES[game.milestone];
  const prevMilestone = game.milestone === 0 ? 0 : MILESTONES[game.milestone - 1];
  const mProgress = nextMilestone
    ? Math.min(1, (game.lifetime - prevMilestone) / (nextMilestone - prevMilestone)) : 1;

  const renownIfReset = Math.floor(Math.sqrt(game.lifetime / 1e6));
  const renownGain = Math.max(0, renownIfReset - game.renown);

  // ——— load + offline earnings + streak ———
  useEffect(() => {
    (async () => {
      let s = freshState();
      let away = 0, earned = 0, streakMsg = null;
      try {
        const res = await window.storage.get(SAVE_KEY);
        if (res?.value) {
          const saved = JSON.parse(res.value);
          s = { ...freshState(), ...saved };
          away = Math.max(0, (Date.now() - (saved.savedAt || Date.now())) / 1000);
          if (away > 60 && saved.perSecAtSave > 0) {
            const capped = Math.min(away, OFFLINE_CAP_H * 3600);
            earned = capped * saved.perSecAtSave * OFFLINE_RATE;
            s.taste += earned;
            s.lifetime += earned;
          }
          // streak
          const today = todayStr();
          if (s.lastDay !== today) {
            if (s.lastDay === yesterdayStr()) { s.streak = (s.streak || 1) + 1; streakMsg = `Day ${s.streak} streak`; }
            else { s.streak = 1; streakMsg = null; }
            s.lastDay = today;
          }
        }
      } catch { /* fresh start */ }
      setGame(s);
      setLoaded(true);
      if (earned > 1 || streakMsg) setWelcome({ away, earned, streak: streakMsg });
    })();
  }, []);

  // ——— income tick ———
  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      setGame((g) => {
        const bonus = Object.values(g.designs).reduce((a, r) => a + (RARITIES[r]?.bonus || 0), 0);
        const cc = WINGS.flatMap((w) => w.collections.filter((c) => c.items.every((it) => g.designs[`${w.id}:${it}`]))).length;
        const mult = (1 + bonus) * Math.pow(1.25, cc) * (1 + g.renown * 0.12) * (1 + Math.min(g.streak - 1, 10) * 0.02);
        const inc = WINGS.reduce((sum, w) => sum + w.studios.reduce((s2, st) => s2 + (g.studios[st.id] || 0) * st.inc, 0), 0) * mult;
        const gain = inc * (TICK_MS / 1000);
        let ng = { ...g, taste: g.taste + gain, lifetime: g.lifetime + gain };
        // milestone auto-claims
        while (ng.milestone < MILESTONES.length && ng.lifetime >= MILESTONES[ng.milestone]) {
          const reward = MILESTONES[ng.milestone] * 0.5;
          ng = { ...ng, taste: ng.taste + reward, milestone: ng.milestone + 1 };
        }
        return ng;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [loaded]);

  // milestone toast (watch index)
  const prevMile = useRef(game.milestone);
  useEffect(() => {
    if (loaded && game.milestone > prevMile.current) {
      toast(`Milestone — press coverage worth ${fmt(MILESTONES[game.milestone - 1] * 0.5)} taste`);
    }
    prevMile.current = game.milestone;
  }, [game.milestone, loaded, toast]);

  // ——— autosave ———
  useEffect(() => {
    if (!loaded) return;
    const save = async () => {
      const g = gameRef.current;
      const bonus = Object.values(g.designs).reduce((a, r) => a + (RARITIES[r]?.bonus || 0), 0);
      const cc = WINGS.flatMap((w) => w.collections.filter((c) => c.items.every((it) => g.designs[`${w.id}:${it}`]))).length;
      const mult = (1 + bonus) * Math.pow(1.25, cc) * (1 + g.renown * 0.12) * (1 + Math.min(g.streak - 1, 10) * 0.02);
      const inc = WINGS.reduce((sum, w) => sum + w.studios.reduce((s2, st) => s2 + (g.studios[st.id] || 0) * st.inc, 0), 0) * mult;
      try {
        await window.storage.set(SAVE_KEY, JSON.stringify({ ...g, savedAt: Date.now(), perSecAtSave: inc }));
      } catch { /* ignore */ }
    };
    const id = setInterval(save, 10_000);
    return () => { clearInterval(id); save(); };
  }, [loaded]);

  // ——— actions ———
  const sketch = () => setGame((g) => ({ ...g, taste: g.taste + tapPower, lifetime: g.lifetime + tapPower }));

  const buyStudio = (st) => setGame((g) => {
    const cost = Math.ceil(st.cost * Math.pow(1.15, g.studios[st.id] || 0));
    if (g.taste < cost) return g;
    return { ...g, taste: g.taste - cost, studios: { ...g.studios, [st.id]: (g.studios[st.id] || 0) + 1 } };
  });

  const commissionDrop = () => {
    const g = gameRef.current;
    if (g.taste < dropCost) return;
    const w = WINGS.find((x) => x.id === wing);
    const pool = w.collections.flatMap((c) => c.items).filter((it) => !g.designs[`${w.id}:${it}`]);
    if (pool.length === 0) {
      // wing complete — jackpot instead
      const jackpot = dropCost * 3;
      setGame((gg) => ({ ...gg, taste: gg.taste - dropCost + jackpot, lifetime: gg.lifetime + jackpot, drops: gg.drops + 1 }));
      toast(`${w.name} lookbook complete — archive sale paid ${fmt(jackpot)} taste`);
      return;
    }
    const name = pool[Math.floor(Math.random() * pool.length)];
    const rarity = rollRarity();
    setGame((gg) => ({
      ...gg,
      taste: gg.taste - dropCost,
      drops: gg.drops + 1,
      designs: { ...gg.designs, [`${w.id}:${name}`]: rarity },
    }));
    setReveal({ name, rarity, wing: w.name });
  };

  const newSeason = () => {
    if (renownGain < 1) return;
    setGame((g) => ({
      ...freshState(),
      renown: g.renown + renownGain,
      season: g.season + 1,
      streak: g.streak,
      lastDay: g.lastDay,
    }));
    setWing("fashion");
    toast(`New season. +${renownGain} renown — the house is stronger.`);
  };

  const activeWing = WINGS.find((w) => w.id === wing);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: PAPER }}>
        <span style={{ fontFamily: DIDOT, fontSize: 28, letterSpacing: "0.4em", color: INK }}>MAISON</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: PAPER, color: INK, fontFamily: SANS }}>
      <style>{`
        @keyframes cardIn { 0% { transform: rotateY(90deg) scale(.9); opacity: 0; } 100% { transform: rotateY(0) scale(1); opacity: 1; } }
        @keyframes sheen { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
        button:focus-visible { outline: 2px solid ${KLEIN}; outline-offset: 2px; }
      `}</style>

      <div className="max-w-md mx-auto px-5 pb-24">

        {/* masthead */}
        <header className="pt-6 pb-4 flex items-end justify-between" style={{ borderBottom: `1px solid ${INK}` }}>
          <div>
            <div style={{ fontFamily: DIDOT, fontSize: 30, letterSpacing: "0.32em", lineHeight: 1 }}>MAISON</div>
            <div className="mt-1" style={{ fontSize: 10, letterSpacing: "0.2em", color: MUTE }}>
              THE IDLE HOUSE OF DESIGN
            </div>
          </div>
          <div className="text-right" style={{ fontSize: 10, letterSpacing: "0.15em" }}>
            <div style={{ color: KLEIN, fontWeight: 600 }}>{seasonName(game.season)}</div>
            <div style={{ color: MUTE }}>RENOWN {game.renown} · DAY {game.streak}</div>
          </div>
        </header>

        {/* taste counter */}
        <section className="text-center pt-8 pb-5">
          <div style={{ fontSize: 10, letterSpacing: "0.3em", color: MUTE }}>TASTE</div>
          <div style={{ fontFamily: DIDOT, fontSize: 56, lineHeight: 1.05 }}>{fmt(game.taste)}</div>
          <div className="mt-1" style={{ fontSize: 12, color: MUTE }}>
            {fmt(perSec)} / sec · house multiplier ×{globalMult.toFixed(2)}
          </div>
          <button
            onClick={sketch}
            className="mt-4 px-8 py-3 active:scale-95 transition-transform"
            style={{ background: INK, color: PAPER, fontSize: 12, letterSpacing: "0.25em" }}
          >
            SKETCH +{fmt(tapPower)}
          </button>
        </section>

        {/* milestone bar */}
        {nextMilestone && (
          <section className="mb-6">
            <div className="flex justify-between mb-1" style={{ fontSize: 10, letterSpacing: "0.12em", color: MUTE }}>
              <span>NEXT PRESS FEATURE</span>
              <span>{Math.floor(mProgress * 100)}% to {fmt(nextMilestone)}</span>
            </div>
            <div style={{ height: 3, background: LINE }}>
              <div style={{ height: 3, width: `${mProgress * 100}%`, background: KLEIN, transition: "width .3s" }} />
            </div>
          </section>
        )}

        {/* wing tabs */}
        <nav className="flex" style={{ borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${LINE}` }}>
          {WINGS.map((w) => {
            const locked = game.lifetime < w.unlock;
            const active = wing === w.id;
            return (
              <button
                key={w.id}
                onClick={() => !locked && setWing(w.id)}
                className="flex-1 py-3"
                style={{
                  fontSize: 11, letterSpacing: "0.15em",
                  color: locked ? "#C4C2BA" : active ? PAPER : INK,
                  background: active ? INK : "transparent",
                }}
              >
                {w.name.toUpperCase()}
                {locked && <div style={{ fontSize: 9, color: "#C4C2BA" }}>{fmt(w.unlock)} lifetime</div>}
              </button>
            );
          })}
        </nav>

        {/* studios */}
        <section className="mt-5">
          <div style={{ fontSize: 10, letterSpacing: "0.25em", color: MUTE }}>STUDIOS</div>
          {activeWing.studios.map((st) => {
            const owned = game.studios[st.id] || 0;
            const cost = studioCost(st);
            const can = game.taste >= cost;
            return (
              <div key={st.id} className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
                <div>
                  <div style={{ fontFamily: DIDOT, fontSize: 17 }}>{st.name}</div>
                  <div style={{ fontSize: 11, color: MUTE }}>
                    {owned > 0 ? `${owned} · ${fmt(st.inc * owned * globalMult)}/sec` : `${fmt(st.inc)}/sec each`}
                  </div>
                </div>
                <button
                  onClick={() => buyStudio(st)}
                  disabled={!can}
                  className="px-4 py-2 active:scale-95 transition-transform"
                  style={{
                    fontSize: 11, letterSpacing: "0.1em",
                    border: `1px solid ${can ? INK : LINE}`,
                    color: can ? INK : "#C4C2BA",
                    background: "transparent",
                  }}
                >
                  {fmt(cost)}
                </button>
              </div>
            );
          })}
        </section>

        {/* drop */}
        <section className="mt-7 p-4" style={{ border: `1px solid ${INK}` }}>
          <div className="flex items-center justify-between">
            <div>
              <div style={{ fontFamily: DIDOT, fontSize: 19 }}>Commission a Drop</div>
              <div style={{ fontSize: 10, color: MUTE, letterSpacing: "0.05em" }}>
                One unseen {activeWing.name.toLowerCase()} piece · 55% House · 30% Refined · 12% Signature · 3% Iconic
              </div>
            </div>
            <button
              onClick={commissionDrop}
              disabled={game.taste < dropCost}
              className="px-5 py-3 active:scale-95 transition-transform"
              style={{
                background: game.taste >= dropCost ? KLEIN : LINE,
                color: game.taste >= dropCost ? "#fff" : "#A5A39B",
                fontSize: 12, letterSpacing: "0.15em",
              }}
            >
              {fmt(dropCost)}
            </button>
          </div>
        </section>

        {/* lookbook / collections */}
        <section className="mt-7">
          <div style={{ fontSize: 10, letterSpacing: "0.25em", color: MUTE }}>LOOKBOOK — {activeWing.name.toUpperCase()}</div>
          {activeWing.collections.map((c) => {
            const done = c.items.every((it) => game.designs[`${activeWing.id}:${it}`]);
            return (
              <div key={c.id} className="mt-4">
                <div className="flex justify-between items-baseline mb-2">
                  <span style={{ fontFamily: DIDOT, fontSize: 15 }}>{c.name}</span>
                  <span style={{ fontSize: 10, letterSpacing: "0.1em", color: done ? KLEIN : MUTE }}>
                    {done ? "COMPLETE · ×1.25" : `${c.items.filter((it) => game.designs[`${activeWing.id}:${it}`]).length}/${c.items.length}`}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {c.items.map((it) => {
                    const key = `${activeWing.id}:${it}`;
                    const r = game.designs[key];
                    return (
                      <div key={it} className="relative" style={{ aspectRatio: "3/4" }}>
                        {r ? (
                          <div className="w-full h-full" style={{ background: swatch(key, r), border: `2px solid ${RARITIES[r].color}` }}>
                            {r === "iconic" && (
                              <div className="w-full h-full" style={{
                                background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,.55) 50%, transparent 60%)",
                                backgroundSize: "200% 100%", animation: "sheen 2.6s linear infinite",
                              }} />
                            )}
                            <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5" style={{ background: "rgba(20,20,18,.72)", color: "#fff", fontSize: 8, lineHeight: 1.2 }}>
                              {it}
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ border: `1px dashed ${LINE}`, color: "#CFCDC5", fontSize: 9, textAlign: "center", padding: 4 }}>
                            {it}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        {/* prestige */}
        <section className="mt-8 p-4 text-center" style={{ background: INK, color: PAPER }}>
          <div style={{ fontFamily: DIDOT, fontSize: 20 }}>Show the Collection</div>
          <div className="mt-1" style={{ fontSize: 11, color: "#B9B8B2", lineHeight: 1.5 }}>
            End {seasonName(game.season)}. Studios and taste reset; renown is forever.
            {renownGain >= 1
              ? ` Ready: +${renownGain} renown (+${renownGain * 12}% permanent).`
              : ` Reach ${fmt(1e6 * Math.pow(game.renown + 1, 2))} lifetime taste to gain renown.`}
          </div>
          <button
            onClick={newSeason}
            disabled={renownGain < 1}
            className="mt-3 px-6 py-2 active:scale-95 transition-transform"
            style={{
              border: `1px solid ${renownGain >= 1 ? PAPER : "#3A3A38"}`,
              color: renownGain >= 1 ? PAPER : "#5A5A57",
              background: "transparent",
              fontSize: 11, letterSpacing: "0.2em",
            }}
          >
            BEGIN {seasonName(game.season + 1)}
          </button>
        </section>

        <footer className="mt-6 text-center" style={{ fontSize: 9, letterSpacing: "0.15em", color: "#C4C2BA" }}>
          LIFETIME {fmt(game.lifetime)} · DROPS {game.drops} · AUTOSAVES EVERY 10s · OFFLINE EARNINGS UP TO {OFFLINE_CAP_H}H
        </footer>
      </div>

      {/* toasts */}
      <div className="fixed bottom-4 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <div key={t.id} className="px-4 py-2" style={{ background: INK, color: PAPER, fontSize: 11, letterSpacing: "0.05em", animation: "rise .25s ease-out" }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* drop reveal */}
      {reveal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-8" style={{ background: "rgba(20,20,18,.88)" }} onClick={() => setReveal(null)}>
          <div className="w-full max-w-xs text-center" style={{ animation: "cardIn .5s cubic-bezier(.2,.9,.3,1.2)" }}>
            <div className="mx-auto relative" style={{ width: 200, height: 266, background: swatch(`${reveal.wing}:${reveal.name}`, reveal.rarity), border: `3px solid ${RARITIES[reveal.rarity].color}` }}>
              {reveal.rarity === "iconic" && (
                <div className="absolute inset-0" style={{
                  background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,.6) 50%, transparent 60%)",
                  backgroundSize: "200% 100%", animation: "sheen 2.2s linear infinite",
                }} />
              )}
            </div>
            <div className="mt-4" style={{ fontSize: 10, letterSpacing: "0.3em", color: RARITIES[reveal.rarity].color, fontWeight: 700 }}>
              {RARITIES[reveal.rarity].label.toUpperCase()}
            </div>
            <div style={{ fontFamily: DIDOT, fontSize: 26, color: PAPER }}>{reveal.name}</div>
            <div style={{ fontSize: 11, color: "#B9B8B2" }}>
              {reveal.wing} · +{Math.round(RARITIES[reveal.rarity].bonus * 100)}% house income, permanently
            </div>
            <button className="mt-5 px-6 py-2" style={{ border: "1px solid #FAFAF7", color: PAPER, fontSize: 11, letterSpacing: "0.2em", background: "transparent" }}>
              INTO THE LOOKBOOK
            </button>
          </div>
        </div>
      )}

      {/* welcome back */}
      {welcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-8" style={{ background: "rgba(20,20,18,.88)" }} onClick={() => setWelcome(null)}>
          <div className="w-full max-w-xs text-center p-6" style={{ background: PAPER, animation: "cardIn .4s ease-out" }}>
            <div style={{ fontFamily: DIDOT, fontSize: 24 }}>While you were out</div>
            {welcome.earned > 1 && (
              <>
                <div className="mt-3" style={{ fontFamily: DIDOT, fontSize: 40, color: KLEIN }}>+{fmt(welcome.earned)}</div>
                <div style={{ fontSize: 11, color: MUTE }}>
                  the studios kept working — {Math.min(welcome.away / 3600, OFFLINE_CAP_H).toFixed(1)}h at half pace
                </div>
              </>
            )}
            {welcome.streak && (
              <div className="mt-3" style={{ fontSize: 12, color: INK }}>
                🔥 {welcome.streak} — income +{Math.min((gameRef.current.streak - 1) * 2, 20)}%
              </div>
            )}
            <button className="mt-5 px-6 py-2" style={{ background: INK, color: PAPER, fontSize: 11, letterSpacing: "0.2em" }}>
              BACK TO WORK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Maison />);

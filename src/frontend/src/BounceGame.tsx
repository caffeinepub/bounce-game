import { useEffect, useRef, useState } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const GRAVITY = 0.5;
const JUMP_FORCE = -12;
const MOVE_SPEED = 4;
const FRICTION = 0.85;
const AIR_RESISTANCE = 0.95;
const RESTITUTION = 0.3;
const BALL_RADIUS = 16;
const TILE_SIZE = 40;
const FIXED_STEP = 1000 / 60; // ~16.67ms

// ─── Web Audio Sound Engine ───────────────────────────────────────────────────
function playTone(
  ctx: AudioContext,
  freq1: number,
  freq2: number,
  type: OscillatorType,
  duration: number,
  gain: number,
  startDelay = 0,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g);
  g.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq1, ctx.currentTime + startDelay);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(0.001, freq2),
    ctx.currentTime + startDelay + duration,
  );
  g.gain.setValueAtTime(gain, ctx.currentTime + startDelay);
  g.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + startDelay + duration,
  );
  osc.start(ctx.currentTime + startDelay);
  osc.stop(ctx.currentTime + startDelay + duration + 0.01);
}

function playNoise(ctx: AudioContext, duration: number, gain: number) {
  const bufSize = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buf;
  src.connect(g);
  g.connect(ctx.destination);
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.start();
  src.stop(ctx.currentTime + duration + 0.01);
}

function createSoundEngine(ctx: AudioContext) {
  return {
    playJump() {
      playTone(ctx, 200, 500, "sine", 0.12, 0.25);
    },
    playLand() {
      playTone(ctx, 120, 60, "triangle", 0.08, 0.18);
    },
    playRing() {
      playTone(ctx, 880, 880, "sine", 0.1, 0.3, 0);
      playTone(ctx, 1100, 1100, "sine", 0.1, 0.3, 0.05);
      playTone(ctx, 1320, 1320, "sine", 0.1, 0.25, 0.1);
    },
    playDeath() {
      playTone(ctx, 300, 80, "sawtooth", 0.3, 0.35);
      playNoise(ctx, 0.3, 0.2);
    },
    playLevelComplete() {
      playTone(ctx, 523, 523, "sine", 0.15, 0.4, 0);
      playTone(ctx, 659, 659, "sine", 0.15, 0.4, 0.15);
      playTone(ctx, 784, 784, "sine", 0.2, 0.4, 0.3);
    },
    playDoorOpen() {
      playTone(ctx, 600, 1200, "sine", 0.2, 0.12);
      playTone(ctx, 1200, 600, "sine", 0.2, 0.12, 0.2);
    },
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────
type GameState =
  | "menu"
  | "levelSelect"
  | "playing"
  | "levelComplete"
  | "gameOver"
  | "win";

interface GridPos {
  col: number;
  row: number;
}

interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  squashX: number;
  squashY: number;
}

interface Camera {
  x: number;
  y: number;
}

interface Ring {
  row: number;
  col: number;
  x: number;
  y: number;
  collected: boolean;
  angle: number;
}

interface ButtonRect {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
}

interface LevelDef {
  cols: number;
  rows: number;
  playerStart: GridPos;
  grid: number[][];
}

// ─── Level Definitions ────────────────────────────────────────────────────────

// Level 1 – Easy: flat platform with gaps, 3 rings, no spikes
const LEVEL1: LevelDef = {
  cols: 30,
  rows: 12,
  playerStart: { col: 1, row: 4 },
  grid: [
    [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ],
    [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ],
    [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ],
    [
      0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0,
      0, 0, 0, 0, 0,
    ],
    [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 4, 0, 0,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1,
      1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ],
  ],
};

// Level 2 – Normal: staircase, spike pit, 5 rings at varied heights
const LEVEL2: LevelDef = {
  cols: 35,
  rows: 18,
  playerStart: { col: 1, row: 15 },
  grid: [
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 3, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 1, 1, 1, 0, 0, 0, 4, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ],
  ],
};

// Level 3 – Hard: gauntlet with corridors, multiple spike pits, 7 rings
const LEVEL3: LevelDef = {
  cols: 40,
  rows: 20,
  playerStart: { col: 1, row: 17 },
  grid: [
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
      1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1,
    ],
    [
      1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ],
  ],
};

const LEVELS: LevelDef[] = [LEVEL1, LEVEL2, LEVEL3];

// ─── Game State ───────────────────────────────────────────────────────────────
interface GameData {
  state: GameState;
  currentLevel: number;
  player: Player;
  camera: Camera;
  rings: Ring[];
  totalRings: number;
  levelData: LevelDef | null;
  buttons: ButtonRect[];
  levelCompleteTimer: number;
  frameCount: number;
  keys: Set<string>;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function BounceGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameData>({
    state: "menu",
    currentLevel: 0,
    player: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      onGround: false,
      squashX: 1,
      squashY: 1,
    },
    camera: { x: 0, y: 0 },
    rings: [],
    totalRings: 0,
    levelData: null,
    buttons: [],
    levelCompleteTimer: 0,
    frameCount: 0,
    keys: new Set(),
  });
  const rafRef = useRef<number>(0);

  // ── Audio refs ─────────────────────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundsRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);

  // ── Performance refs ───────────────────────────────────────────────────────
  const lastTimeRef = useRef<number>(0);
  const accumRef = useRef<number>(0);

  // Offscreen tile cache
  const tileCanvasRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(
    null,
  );
  const tileCtxRef = useRef<
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  >(null);
  const tileCacheRef = useRef({ x: 0, y: 0, w: 0, h: 0, isDirty: true });

  // Door unlock tracking
  const doorUnlockedRef = useRef(false);

  // Touch state: which virtual buttons are pressed
  const touchRef = useRef({ left: false, right: false, jump: false });

  // Portrait detection (for rotate overlay)
  const [isPortrait, setIsPortrait] = useState(
    () => window.innerHeight > window.innerWidth,
  );
  // Whether to show on-screen buttons (touch device OR small screen)
  const [showTouchControls, setShowTouchControls] = useState(false);

  useEffect(() => {
    const checkLayout = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
      // Show touch controls on touch-capable or narrow devices
      const isTouchDevice =
        navigator.maxTouchPoints > 0 ||
        window.matchMedia("(pointer: coarse)").matches;
      setShowTouchControls(isTouchDevice || window.innerWidth < 1024);
    };
    checkLayout();
    window.addEventListener("resize", checkLayout);
    window.addEventListener("orientationchange", checkLayout);
    return () => {
      window.removeEventListener("resize", checkLayout);
      window.removeEventListener("orientationchange", checkLayout);
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas: HTMLCanvasElement = canvasRef.current;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

    // ── Audio init ────────────────────────────────────────────────────────────
    function initAudio() {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext
        )();
        soundsRef.current = createSoundEngine(audioCtxRef.current);
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {
          /* ignore */
        });
      }
    }

    // ── Resize ────────────────────────────────────────────────────────────────
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      tileCacheRef.current.isDirty = true;
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    // ── Keyboard ──────────────────────────────────────────────────────────────
    const GAME_KEYS = new Set([
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "a",
      "A",
      "d",
      "D",
      "w",
      "W",
      " ",
    ]);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (GAME_KEYS.has(e.key)) e.preventDefault();
      initAudio();
      gameRef.current.keys.add(e.key);
      const g = gameRef.current;
      if (
        g.state === "playing" &&
        (e.key === "ArrowUp" || e.key === "w" || e.key === "W" || e.key === " ")
      ) {
        if (g.player.onGround) {
          g.player.vy = JUMP_FORCE;
          g.player.onGround = false;
          g.player.squashX = 0.8;
          g.player.squashY = 1.3;
          soundsRef.current?.playJump();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      gameRef.current.keys.delete(e.key);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // ── Mouse / touch (for canvas UI buttons) ─────────────────────────────────
    const handleClick = (e: MouseEvent) => {
      initAudio();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const g = gameRef.current;
      for (const btn of g.buttons) {
        if (
          mx >= btn.x &&
          mx <= btn.x + btn.w &&
          my >= btn.y &&
          my <= btn.y + btn.h
        ) {
          handleAction(btn.action);
          break;
        }
      }
    };
    canvas.addEventListener("click", handleClick);

    // Also handle tap on canvas for menu buttons
    const handleTouchTap = (e: TouchEvent) => {
      // Only handle single-tap on non-playing states for canvas UI buttons
      const g = gameRef.current;
      if (g.state === "playing") return;
      e.preventDefault();
      initAudio();
      const touch = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const mx = touch.clientX - rect.left;
      const my = touch.clientY - rect.top;
      for (const btn of g.buttons) {
        if (
          mx >= btn.x &&
          mx <= btn.x + btn.w &&
          my >= btn.y &&
          my <= btn.y + btn.h
        ) {
          handleAction(btn.action);
          break;
        }
      }
    };
    canvas.addEventListener("touchend", handleTouchTap, { passive: false });

    // Touchstart to init audio
    const handleTouchStart = (e: TouchEvent) => {
      initAudio();
      // suppress unused warning
      void e;
    };
    window.addEventListener("touchstart", handleTouchStart, { passive: true });

    // ── Actions ───────────────────────────────────────────────────────────────
    function handleAction(action: string) {
      const g = gameRef.current;
      switch (action) {
        case "startGame":
          g.state = "levelSelect";
          break;
        case "level1":
          loadLevel(0);
          break;
        case "level2":
          loadLevel(1);
          break;
        case "level3":
          loadLevel(2);
          break;
        case "restart":
          loadLevel(g.currentLevel);
          break;
        case "menu":
          g.state = "menu";
          break;
        case "back":
          g.state = "menu";
          break;
        case "nextLevel":
          if (g.currentLevel + 1 < LEVELS.length) loadLevel(g.currentLevel + 1);
          else g.state = "win";
          break;
        case "playAgain":
          loadLevel(0);
          break;
      }
    }

    // Expose handleAction for touch button refs
    (
      canvas as HTMLCanvasElement & { __handleAction?: (a: string) => void }
    ).__handleAction = handleAction;

    // ── Level Loader ──────────────────────────────────────────────────────────
    function loadLevel(index: number) {
      const g = gameRef.current;
      const levelDef = LEVELS[index];
      g.currentLevel = index;
      g.levelData = levelDef;

      const startX = levelDef.playerStart.col * TILE_SIZE + TILE_SIZE / 2;
      const startY = levelDef.playerStart.row * TILE_SIZE + TILE_SIZE / 2;

      g.player = {
        x: startX,
        y: startY,
        vx: 0,
        vy: 0,
        onGround: false,
        squashX: 1,
        squashY: 1,
      };

      g.rings = [];
      for (let row = 0; row < levelDef.rows; row++) {
        for (let col = 0; col < levelDef.cols; col++) {
          if (levelDef.grid[row][col] === 3) {
            g.rings.push({
              row,
              col,
              x: col * TILE_SIZE + TILE_SIZE / 2,
              y: row * TILE_SIZE + TILE_SIZE / 2,
              collected: false,
              angle: 0,
            });
          }
        }
      }
      g.totalRings = g.rings.length;
      g.camera.x = startX - canvas.width / 2;
      g.camera.y = startY - canvas.height / 2;
      g.state = "playing";
      g.levelCompleteTimer = 0;

      // Reset door unlock tracker for new level
      doorUnlockedRef.current = false;
      // Mark tile cache dirty
      tileCacheRef.current.isDirty = true;
    }

    // ── Tile Query ────────────────────────────────────────────────────────────
    function getTile(levelDef: LevelDef, col: number, row: number): number {
      if (row < 0 || row >= levelDef.rows || col < 0 || col >= levelDef.cols)
        return 1;
      return levelDef.grid[row][col];
    }

    // ── Physics ───────────────────────────────────────────────────────────────
    function updatePlayer() {
      const g = gameRef.current;
      const p = g.player;
      const levelDef = g.levelData;
      if (!levelDef) return;

      const keys = g.keys;
      const touch = touchRef.current;

      const movingLeft =
        keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || touch.left;
      const movingRight =
        keys.has("ArrowRight") || keys.has("d") || keys.has("D") || touch.right;

      if (movingLeft) p.vx -= MOVE_SPEED * 0.4;
      if (movingRight) p.vx += MOVE_SPEED * 0.4;

      const maxSpeed = MOVE_SPEED * 1.5;
      if (p.vx > maxSpeed) p.vx = maxSpeed;
      if (p.vx < -maxSpeed) p.vx = -maxSpeed;

      p.vx *= p.onGround ? FRICTION : AIR_RESISTANCE;
      p.vy += GRAVITY;
      if (p.vy > 20) p.vy = 20;

      p.x += p.vx;
      resolveCollisionsX(p, levelDef);
      p.y += p.vy;
      p.onGround = false;
      resolveCollisionsY(p, levelDef);

      if (!p.onGround && Math.abs(p.vy) > 5) {
        p.squashX = 0.85;
        p.squashY = 1.15;
      }
      p.squashX += (1 - p.squashX) * 0.2;
      p.squashY += (1 - p.squashY) * 0.2;

      const levelW = levelDef.cols * TILE_SIZE;
      const levelH = levelDef.rows * TILE_SIZE;
      if (p.x < BALL_RADIUS) {
        p.x = BALL_RADIUS;
        p.vx = 0;
      }
      if (p.x > levelW - BALL_RADIUS) {
        p.x = levelW - BALL_RADIUS;
        p.vx = 0;
      }
      if (p.y > levelH + 100) {
        g.state = "gameOver";
        soundsRef.current?.playDeath();
      }
    }

    function resolveCollisionsX(p: Player, levelDef: LevelDef) {
      const r = BALL_RADIUS;
      const probes = [
        { dx: -r, dy: 0 },
        { dx: r, dy: 0 },
        { dx: -r, dy: -r * 0.6 },
        { dx: r, dy: -r * 0.6 },
      ];
      for (const s of probes) {
        const col = Math.floor((p.x + s.dx) / TILE_SIZE);
        const row = Math.floor((p.y + s.dy) / TILE_SIZE);
        if (getTile(levelDef, col, row) === 1) {
          if (s.dx > 0) p.x = col * TILE_SIZE - r - 0.1;
          else p.x = (col + 1) * TILE_SIZE + r + 0.1;
          p.vx = 0;
        }
      }
    }

    function resolveCollisionsY(p: Player, levelDef: LevelDef) {
      const r = BALL_RADIUS;
      const topProbes = [
        { dx: 0, dy: -r },
        { dx: -r * 0.7, dy: -r * 0.7 },
        { dx: r * 0.7, dy: -r * 0.7 },
      ];
      for (const s of topProbes) {
        const col = Math.floor((p.x + s.dx) / TILE_SIZE);
        const row = Math.floor((p.y + s.dy) / TILE_SIZE);
        if (getTile(levelDef, col, row) === 1) {
          p.y = (row + 1) * TILE_SIZE + r + 0.1;
          if (p.vy < 0) p.vy = Math.abs(p.vy) * RESTITUTION;
          break;
        }
      }
      const btmProbes = [
        { dx: 0, dy: r },
        { dx: -r * 0.7, dy: r * 0.7 },
        { dx: r * 0.7, dy: r * 0.7 },
      ];
      for (const s of btmProbes) {
        const col = Math.floor((p.x + s.dx) / TILE_SIZE);
        const row = Math.floor((p.y + s.dy) / TILE_SIZE);
        if (getTile(levelDef, col, row) === 1) {
          p.y = row * TILE_SIZE - r - 0.1;
          if (p.vy > 0) {
            if (Math.abs(p.vy) > 6) {
              soundsRef.current?.playLand();
            }
            if (Math.abs(p.vy) > 3) {
              p.vy = -p.vy * RESTITUTION;
              p.squashX = 1.3;
              p.squashY = 0.7;
            } else {
              p.vy = 0;
            }
          }
          p.onGround = true;
          break;
        }
      }
    }

    function checkInteractables() {
      const g = gameRef.current;
      const p = g.player;
      const levelDef = g.levelData;
      if (!levelDef) return;

      const pCol = Math.floor(p.x / TILE_SIZE);
      const pRow = Math.floor(p.y / TILE_SIZE);

      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const tc = pCol + dc;
          const tr = pRow + dr;
          const tile = getTile(levelDef, tc, tr);
          if (tile === 2) {
            const sx = tc * TILE_SIZE + TILE_SIZE / 2;
            const sy = tr * TILE_SIZE + TILE_SIZE * 0.2;
            const ddx = p.x - sx;
            const ddy = p.y - sy;
            if (Math.sqrt(ddx * ddx + ddy * ddy) < BALL_RADIUS + 10) {
              g.state = "gameOver";
              soundsRef.current?.playDeath();
              return;
            }
          }
          if (tile === 4) {
            const collectedCount = g.rings.filter(
              (rng) => rng.collected,
            ).length;

            // Play door-open sound once when all rings are collected
            if (collectedCount >= g.totalRings && !doorUnlockedRef.current) {
              doorUnlockedRef.current = true;
              soundsRef.current?.playDoorOpen();
            }

            if (collectedCount >= g.totalRings) {
              const ex = tc * TILE_SIZE + TILE_SIZE / 2;
              const ey = tr * TILE_SIZE + TILE_SIZE / 2;
              const ddx = p.x - ex;
              const ddy = p.y - ey;
              if (
                Math.sqrt(ddx * ddx + ddy * ddy) <
                BALL_RADIUS + TILE_SIZE / 2
              ) {
                g.state = "levelComplete";
                g.levelCompleteTimer = 0;
                soundsRef.current?.playLevelComplete();
                return;
              }
            }
          }
        }
      }

      for (const ring of g.rings) {
        if (ring.collected) continue;
        const ddx = p.x - ring.x;
        const ddy = p.y - ring.y;
        if (Math.sqrt(ddx * ddx + ddy * ddy) < BALL_RADIUS + 15) {
          ring.collected = true;
          soundsRef.current?.playRing();
        }
      }
    }

    function updateCamera() {
      const g = gameRef.current;
      const p = g.player;
      const levelDef = g.levelData;
      if (!levelDef) return;

      const W = canvas.width;
      const H = canvas.height;
      const targetX = p.x - W / 2;
      const targetY = p.y - H / 2;
      const prevX = g.camera.x;
      const prevY = g.camera.y;
      g.camera.x += (targetX - g.camera.x) * 0.1;
      g.camera.y += (targetY - g.camera.y) * 0.1;

      const maxCamX = Math.max(0, levelDef.cols * TILE_SIZE - W);
      const maxCamY = Math.max(0, levelDef.rows * TILE_SIZE - H);
      g.camera.x = Math.max(0, Math.min(maxCamX, g.camera.x));
      g.camera.y = Math.max(0, Math.min(maxCamY, g.camera.y));

      // Mark tile cache dirty if camera moved significantly
      const dx = Math.abs(g.camera.x - tileCacheRef.current.x);
      const dy = Math.abs(g.camera.y - tileCacheRef.current.y);
      if (dx > 40 || dy > 40 || prevX !== g.camera.x || prevY !== g.camera.y) {
        tileCacheRef.current.isDirty = true;
      }
    }

    // ── Offscreen tile cache ───────────────────────────────────────────────────
    function rebuildTileCache(
      levelDef: LevelDef,
      W: number,
      H: number,
      camX: number,
      camY: number,
    ) {
      // Create or resize offscreen canvas
      if (
        !tileCanvasRef.current ||
        tileCacheRef.current.w !== W ||
        tileCacheRef.current.h !== H
      ) {
        if (typeof OffscreenCanvas !== "undefined") {
          tileCanvasRef.current = new OffscreenCanvas(W, H);
          tileCtxRef.current = tileCanvasRef.current.getContext(
            "2d",
          ) as OffscreenCanvasRenderingContext2D;
        } else {
          const c = document.createElement("canvas");
          c.width = W;
          c.height = H;
          tileCanvasRef.current = c;
          tileCtxRef.current = c.getContext("2d") as CanvasRenderingContext2D;
        }
      }

      const tc = tileCtxRef.current;
      if (!tc) return;

      tc.clearRect(0, 0, W, H);

      const startCol = Math.max(0, Math.floor(camX / TILE_SIZE) - 1);
      const endCol = Math.min(
        levelDef.cols - 1,
        Math.ceil((camX + W) / TILE_SIZE) + 1,
      );
      const startRow = Math.max(0, Math.floor(camY / TILE_SIZE) - 1);
      const endRow = Math.min(
        levelDef.rows - 1,
        Math.ceil((camY + H) / TILE_SIZE) + 1,
      );

      const collectedCount = gameRef.current.rings.filter(
        (r) => r.collected,
      ).length;
      const totalRings = gameRef.current.totalRings;
      const frameCount = gameRef.current.frameCount;

      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          const tile = levelDef.grid[row][col];
          const tx = col * TILE_SIZE - camX;
          const ty = row * TILE_SIZE - camY;
          if (tile === 1) drawBrickOffscreen(tc, tx, ty, row);
          else if (tile === 2) drawSpikeOffscreen(tc, tx, ty);
          else if (tile === 4)
            drawExitDoorOffscreen(
              tc,
              tx,
              ty,
              collectedCount >= totalRings,
              frameCount,
            );
        }
      }

      tileCacheRef.current = { x: camX, y: camY, w: W, h: H, isDirty: false };
    }

    function drawBrickOffscreen(
      tc: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      bx: number,
      by: number,
      tileRow: number,
    ) {
      const T = TILE_SIZE;
      tc.fillStyle = "#CC4444";
      tc.fillRect(bx, by, T, T);
      tc.fillStyle = "#AA2222";
      tc.fillRect(bx, by, T, 2);
      tc.fillRect(bx, by + T - 2, T, 2);
      tc.strokeStyle = "#888888";
      tc.lineWidth = 1.5;
      for (let gy = 13; gy < T; gy += 13) {
        tc.beginPath();
        tc.moveTo(bx, by + gy);
        tc.lineTo(bx + T, by + gy);
        tc.stroke();
      }
      const off = tileRow % 2 === 0 ? 0 : T / 2;
      for (let gx = off; gx <= T; gx += T / 2) {
        tc.beginPath();
        tc.moveTo(bx + gx, by);
        tc.lineTo(bx + gx, by + T);
        tc.stroke();
      }
      tc.fillStyle = "rgba(255,255,255,0.08)";
      tc.fillRect(bx, by, T, 3);
    }

    function drawSpikeOffscreen(
      tc: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sx: number,
      sy: number,
    ) {
      const T = TILE_SIZE;
      tc.save();
      tc.beginPath();
      tc.moveTo(sx + T / 2, sy + T * 0.1);
      tc.lineTo(sx + T * 0.9, sy + T);
      tc.lineTo(sx + T * 0.1, sy + T);
      tc.closePath();
      tc.fillStyle = "#999999";
      tc.fill();
      tc.strokeStyle = "#555555";
      tc.lineWidth = 1.5;
      tc.stroke();
      tc.beginPath();
      tc.moveTo(sx + T / 2, sy + T * 0.1);
      tc.lineTo(sx + T / 2 - 3, sy + T * 0.1 + 8);
      tc.strokeStyle = "rgba(255,255,255,0.4)";
      tc.lineWidth = 1;
      tc.stroke();
      tc.restore();
    }

    function drawExitDoorOffscreen(
      tc: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      dx: number,
      dy: number,
      isOpen: boolean,
      frame: number,
    ) {
      const T = TILE_SIZE;
      tc.save();
      const frameColor = isOpen ? "#00CC00" : "#CC0000";
      const fillColor = isOpen ? "rgba(0,180,0,0.6)" : "rgba(100,0,0,0.6)";
      if (isOpen) {
        const pulse = Math.sin(frame * 0.05) * 0.5 + 0.5;
        tc.shadowBlur = 20 * pulse;
        tc.shadowColor = "#00FF00";
      }
      tc.strokeStyle = frameColor;
      tc.lineWidth = 4;
      tc.strokeRect(dx + 4, dy + 4, T - 8, T - 8);
      tc.fillStyle = fillColor;
      tc.fillRect(dx + 6, dy + 6, T - 12, T - 12);
      tc.strokeStyle = isOpen ? "#00FF88" : "#FF4444";
      tc.lineWidth = 3;
      const ecx = dx + T / 2;
      const ecy = dy + T / 2;
      tc.beginPath();
      tc.moveTo(ecx - 8, ecy + 4);
      tc.lineTo(ecx, ecy - 4);
      tc.lineTo(ecx + 8, ecy + 4);
      tc.stroke();
      tc.restore();
    }

    // ── Render Helpers ────────────────────────────────────────────────────────
    function registerButton(
      x: number,
      y: number,
      w: number,
      h: number,
      action: string,
    ) {
      const g = gameRef.current;
      const existing = g.buttons.find((b) => b.action === action);
      if (existing) {
        existing.x = x;
        existing.y = y;
        existing.w = w;
        existing.h = h;
      } else g.buttons.push({ x, y, w, h, action });
    }

    function drawButton(
      x: number,
      y: number,
      w: number,
      h: number,
      label: string,
      action: string,
      bg = "#FFD700",
      fg = "#1a1a2e",
    ) {
      registerButton(x, y, w, h, action);
      const rad = 8;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x + w - rad, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
      ctx.lineTo(x + w, y + h - rad);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      ctx.lineTo(x + rad, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
      ctx.lineTo(x, y + rad);
      ctx.quadraticCurveTo(x, y, x + rad, y);
      ctx.closePath();
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.font = "bold 18px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + w / 2, y + h / 2);
      ctx.restore();
    }

    function drawBackground() {
      const W = canvas.width;
      const H = canvas.height;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#87CEEB");
      grad.addColorStop(1, "#B0E8FF");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    function drawRing(
      rx: number,
      ry: number,
      angle: number,
      screenCenterX: number,
    ) {
      ctx.save();
      ctx.translate(rx, ry);
      // Only apply shadow/glow for rings near screen center (reduce GPU overdraw)
      const distFromCenter = Math.abs(rx - screenCenterX);
      if (distFromCenter < 200) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = "#FFD700";
      }
      const minorY = 14 * Math.abs(Math.cos(angle * 0.5 + 0.1));
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, Math.max(1, minorY), 0, 0, Math.PI * 2);
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.shadowBlur = distFromCenter < 200 ? 5 : 0;
      const minorY2 = 8 * Math.abs(Math.cos(angle * 0.5 + 0.1));
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, Math.max(1, minorY2), 0, 0, Math.PI * 2);
      ctx.strokeStyle = "#FFF176";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    function drawPlayer(
      px: number,
      py: number,
      squashX: number,
      squashY: number,
    ) {
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(squashX * 1.2, 0.3);
      const sg = ctx.createRadialGradient(
        0,
        BALL_RADIUS + 4,
        0,
        0,
        BALL_RADIUS + 4,
        BALL_RADIUS * 1.2,
      );
      sg.addColorStop(0, "rgba(0,0,0,0.35)");
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, BALL_RADIUS + 4, BALL_RADIUS * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(px, py);
      ctx.scale(squashX, squashY);
      const grad = ctx.createRadialGradient(
        -BALL_RADIUS * 0.3,
        -BALL_RADIUS * 0.3,
        BALL_RADIUS * 0.1,
        0,
        0,
        BALL_RADIUS,
      );
      grad.addColorStop(0, "rgba(255,200,200,0.9)");
      grad.addColorStop(0.4, "rgba(220,30,30,1)");
      grad.addColorStop(1, "rgba(120,0,0,1)");
      ctx.beginPath();
      ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        -BALL_RADIUS * 0.3,
        -BALL_RADIUS * 0.35,
        BALL_RADIUS * 0.3,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fill();
      ctx.restore();
    }

    function drawLevel(g: GameData) {
      const levelDef = g.levelData;
      if (!levelDef) return;

      const cam = g.camera;
      const W = canvas.width;
      const H = canvas.height;

      // Use offscreen tile cache for static tiles
      if (tileCacheRef.current.isDirty) {
        rebuildTileCache(levelDef, W, H, cam.x, cam.y);
      }

      // Composite cached tile layer
      if (tileCanvasRef.current) {
        ctx.drawImage(tileCanvasRef.current as CanvasImageSource, 0, 0);
      }

      // Draw animated rings on top (they rotate so can't be cached)
      const screenCenterX = W / 2;
      for (const ring of g.rings) {
        if (ring.collected) continue;
        const rx = ring.x - cam.x;
        const ry = ring.y - cam.y;
        if (rx > -50 && rx < W + 50 && ry > -50 && ry < H + 50)
          drawRing(rx, ry, ring.angle, screenCenterX);
      }
    }

    function drawHUD(g: GameData) {
      const collected = g.rings.filter((rng) => rng.collected).length;
      const W = canvas.width;
      ctx.save();
      ctx.font = "bold 18px 'Courier New', monospace";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(`Rings: ${collected} / ${g.totalRings}`, 17, 17);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(`Rings: ${collected} / ${g.totalRings}`, 15, 15);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(`Level ${g.currentLevel + 1}`, W - 13, 17);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(`Level ${g.currentLevel + 1}`, W - 15, 15);
      ctx.restore();
    }

    // ── Menu screens ──────────────────────────────────────────────────────────
    function drawMenu() {
      const g = gameRef.current;
      g.buttons = [];
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      ctx.fillStyle = "#0d2137";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.strokeStyle = "rgba(100,200,255,0.07)";
      ctx.lineWidth = 1;
      const off = (g.frameCount * 0.3) % 40;
      for (let x = -40 + off; x < W + 40; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.shadowBlur = 40;
      ctx.shadowColor = "#FFD700";
      ctx.font = "bold 80px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tg = ctx.createLinearGradient(
        cx - 200,
        cy - 120,
        cx + 200,
        cy - 60,
      );
      tg.addColorStop(0, "#FFD700");
      tg.addColorStop(0.5, "#FFF176");
      tg.addColorStop(1, "#FF8C00");
      ctx.fillStyle = tg;
      ctx.fillText("BOUNCE", cx, cy - 100);
      ctx.restore();

      ctx.save();
      ctx.font = "18px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#87CEEB";
      ctx.fillText("A Nokia Classic Tribute", cx, cy - 50);
      ctx.restore();

      const bally = cy + 10 - Math.abs(Math.sin(g.frameCount * 0.04)) * 30;
      drawPlayer(cx, bally, 1, 1);

      drawButton(
        cx - 100,
        cy + 70,
        200,
        50,
        "\u25B6  Start Game",
        "startGame",
        "#FFD700",
        "#1a1a2e",
      );

      ctx.save();
      ctx.font = "13px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(135,206,235,0.7)";
      ctx.fillText(
        "\u2190 \u2192 / A D : Move    \u2191 / W / Space : Jump",
        cx,
        H - 20,
      );
      ctx.restore();
    }

    function drawLevelSelect() {
      const g = gameRef.current;
      g.buttons = [];
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      ctx.fillStyle = "#0d2137";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.font = "bold 40px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#FFD700";
      ctx.fillText("SELECT LEVEL", cx, cy - 150);
      ctx.restore();

      const cards = [
        { label: "Level 1", sub: "Easy", color: "#4CAF50", action: "level1" },
        { label: "Level 2", sub: "Normal", color: "#FF9800", action: "level2" },
        { label: "Level 3", sub: "Hard", color: "#f44336", action: "level3" },
      ];

      const cardW = 160;
      const cardH = 100;
      const gap = 30;
      const totalW = cards.length * cardW + (cards.length - 1) * gap;
      const startX = cx - totalW / 2;

      cards.forEach((lv, i) => {
        const x = startX + i * (cardW + gap);
        const y = cy - cardH / 2;
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.strokeStyle = lv.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, cardW, cardH, 10);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 22px 'Courier New', monospace";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(lv.label, x + cardW / 2, y + cardH / 2 - 12);
        ctx.font = "15px 'Courier New', monospace";
        ctx.fillStyle = lv.color;
        ctx.fillText(lv.sub, x + cardW / 2, y + cardH / 2 + 15);
        ctx.restore();
        registerButton(x, y, cardW, cardH, lv.action);
      });

      drawButton(
        cx - 80,
        cy + 90,
        160,
        45,
        "\u2190 Back",
        "back",
        "#555577",
        "#FFFFFF",
      );
    }

    function drawLevelComplete(g: GameData) {
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const secondsLeft = Math.ceil(2 - g.levelCompleteTimer / 60);
      const collected = g.rings.filter((rng) => rng.collected).length;

      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "bold 56px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#00FF88";
      ctx.fillStyle = "#00FF88";
      ctx.fillText("LEVEL COMPLETE!", cx, cy - 60);
      ctx.shadowBlur = 0;
      ctx.font = "22px 'Courier New', monospace";
      ctx.fillStyle = "#FFD700";
      ctx.fillText(`Rings: ${collected} / ${g.totalRings}`, cx, cy);
      ctx.font = "18px 'Courier New', monospace";
      ctx.fillStyle = "#87CEEB";
      ctx.fillText(`Next level in ${secondsLeft}...`, cx, cy + 50);
      ctx.restore();
    }

    function drawGameOver() {
      const g = gameRef.current;
      g.buttons = [];
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "bold 64px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 30;
      ctx.shadowColor = "#FF0000";
      ctx.fillStyle = "#FF3333";
      ctx.fillText("GAME OVER", cx, cy - 80);
      ctx.shadowBlur = 0;
      ctx.font = "20px 'Courier New', monospace";
      ctx.fillStyle = "#AAAAAA";
      ctx.fillText("You hit a spike or fell!", cx, cy - 20);
      ctx.restore();

      drawButton(
        cx - 170,
        cy + 30,
        150,
        50,
        "\u21BA Restart",
        "restart",
        "#CC4444",
        "#FFFFFF",
      );
      drawButton(
        cx + 20,
        cy + 30,
        150,
        50,
        "\u2302 Menu",
        "menu",
        "#4455AA",
        "#FFFFFF",
      );
    }

    function drawWin() {
      const g = gameRef.current;
      g.buttons = [];
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      ctx.save();
      ctx.fillStyle = "rgba(0,20,0,0.85)";
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 30; i++) {
        const sx = (i * 137.5) % W;
        const sy = (i * 73.3) % H;
        const pulse = Math.sin(g.frameCount * 0.05 + i) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255,215,0,${pulse})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 2 + pulse * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 40;
      ctx.shadowColor = "#FFD700";
      ctx.font = "bold 52px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const wg = ctx.createLinearGradient(cx - 280, cy - 80, cx + 280, cy - 30);
      wg.addColorStop(0, "#FFD700");
      wg.addColorStop(0.5, "#FFF176");
      wg.addColorStop(1, "#FF8C00");
      ctx.fillStyle = wg;
      ctx.fillText("YOU WIN THE GAME!", cx, cy - 80);
      ctx.shadowBlur = 0;
      ctx.font = "22px 'Courier New', monospace";
      ctx.fillStyle = "#87CEEB";
      ctx.fillText("All 3 levels completed!", cx, cy - 20);
      ctx.restore();

      drawButton(
        cx - 170,
        cy + 40,
        150,
        50,
        "\u25B6 Play Again",
        "playAgain",
        "#FFD700",
        "#1a1a2e",
      );
      drawButton(
        cx + 20,
        cy + 40,
        150,
        50,
        "\u2302 Main Menu",
        "menu",
        "#4455AA",
        "#FFFFFF",
      );
    }

    // ── Fixed-Timestep Game Loop ───────────────────────────────────────────────
    function gameLoop(timestamp: number) {
      const dt = Math.min(timestamp - lastTimeRef.current, 50); // cap at 50ms to prevent spiral-of-death
      lastTimeRef.current = timestamp;
      accumRef.current += dt;

      const g = gameRef.current;

      // Fixed-step physics updates
      if (g.state === "playing" || g.state === "levelComplete") {
        while (accumRef.current >= FIXED_STEP) {
          updatePlayer();
          checkInteractables();
          updateCamera();
          for (const ring of g.rings) ring.angle += 0.04;
          accumRef.current -= FIXED_STEP;
        }
      }

      // Render once per RAF (decoupled from physics)
      g.frameCount++;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      switch (g.state) {
        case "menu":
          drawMenu();
          break;
        case "levelSelect":
          drawLevelSelect();
          break;
        case "playing":
          drawBackground();
          drawLevel(g);
          drawPlayer(
            g.player.x - g.camera.x,
            g.player.y - g.camera.y,
            g.player.squashX,
            g.player.squashY,
          );
          drawHUD(g);
          break;
        case "levelComplete":
          drawBackground();
          drawLevel(g);
          drawPlayer(
            g.player.x - g.camera.x,
            g.player.y - g.camera.y,
            g.player.squashX,
            g.player.squashY,
          );
          drawHUD(g);
          drawLevelComplete(g);
          g.levelCompleteTimer++;
          if (g.levelCompleteTimer >= 120) handleAction("nextLevel");
          break;
        case "gameOver":
          drawBackground();
          drawLevel(g);
          drawPlayer(
            g.player.x - g.camera.x,
            g.player.y - g.camera.y,
            g.player.squashX,
            g.player.squashY,
          );
          drawGameOver();
          break;
        case "win":
          drawWin();
          break;
      }

      rafRef.current = requestAnimationFrame(gameLoop);
    }

    canvas.focus();
    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("touchend", handleTouchTap);
    };
  }, []);

  // ── Touch button handlers ─────────────────────────────────────────────────
  const handleTouchStartBtn =
    (key: "left" | "right" | "jump") => (e: React.TouchEvent) => {
      e.preventDefault();
      // Init audio on first touch
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext
        )();
        soundsRef.current = createSoundEngine(audioCtxRef.current);
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {
          /* ignore */
        });
      }
      touchRef.current[key] = true;
      if (key === "jump") {
        const g = gameRef.current;
        if (g.state === "playing" && g.player.onGround) {
          g.player.vy = JUMP_FORCE;
          g.player.onGround = false;
          g.player.squashX = 0.8;
          g.player.squashY = 1.3;
          soundsRef.current?.playJump();
        }
      }
    };

  const handleTouchEndBtn =
    (key: "left" | "right" | "jump") => (e: React.TouchEvent) => {
      e.preventDefault();
      touchRef.current[key] = false;
    };

  // Button size: responsive
  const btnSize = Math.min(72, Math.max(52, window.innerWidth * 0.1));
  const btnStyle = (pressed?: boolean): React.CSSProperties => ({
    width: btnSize,
    height: btnSize,
    borderRadius: "50%",
    background: pressed ? "rgba(255,215,0,0.55)" : "rgba(255,255,255,0.18)",
    border: "2px solid rgba(255,255,255,0.45)",
    color: "#fff",
    fontSize: Math.round(btnSize * 0.38),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
    boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
    transition: "background 0.08s",
    backdropFilter: "blur(4px)",
  });

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#0d2137",
      }}
    >
      {/* Game canvas */}
      <canvas
        ref={canvasRef}
        data-ocid="game.canvas_target"
        tabIndex={0}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          outline: "none",
          cursor: "default",
          willChange: "transform",
        }}
      />

      {/* On-screen touch controls (shown on touch/mobile devices) */}
      {showTouchControls && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: btnSize + 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            pointerEvents: "none",
          }}
        >
          {/* Left / Right */}
          <div style={{ display: "flex", gap: 12, pointerEvents: "auto" }}>
            <button
              type="button"
              data-ocid="game.left.button"
              style={btnStyle()}
              onTouchStart={handleTouchStartBtn("left")}
              onTouchEnd={handleTouchEndBtn("left")}
              onMouseDown={() => {
                touchRef.current.left = true;
              }}
              onMouseUp={() => {
                touchRef.current.left = false;
              }}
              onMouseLeave={() => {
                touchRef.current.left = false;
              }}
              aria-label="Move Left"
            >
              ◀
            </button>
            <button
              type="button"
              data-ocid="game.right.button"
              style={btnStyle()}
              onTouchStart={handleTouchStartBtn("right")}
              onTouchEnd={handleTouchEndBtn("right")}
              onMouseDown={() => {
                touchRef.current.right = true;
              }}
              onMouseUp={() => {
                touchRef.current.right = false;
              }}
              onMouseLeave={() => {
                touchRef.current.right = false;
              }}
              aria-label="Move Right"
            >
              ▶
            </button>
          </div>

          {/* Jump */}
          <div style={{ pointerEvents: "auto" }}>
            <button
              type="button"
              data-ocid="game.jump.button"
              style={{
                ...btnStyle(),
                width: btnSize * 1.15,
                height: btnSize * 1.15,
                fontSize: Math.round(btnSize * 0.42),
              }}
              onTouchStart={handleTouchStartBtn("jump")}
              onTouchEnd={handleTouchEndBtn("jump")}
              onMouseDown={() => {
                touchRef.current.jump = true;
                const g = gameRef.current;
                if (g.state === "playing" && g.player.onGround) {
                  g.player.vy = JUMP_FORCE;
                  g.player.onGround = false;
                  g.player.squashX = 0.8;
                  g.player.squashY = 1.3;
                  soundsRef.current?.playJump();
                }
              }}
              onMouseUp={() => {
                touchRef.current.jump = false;
              }}
              onMouseLeave={() => {
                touchRef.current.jump = false;
              }}
              aria-label="Jump"
            >
              ▲
            </button>
          </div>
        </div>
      )}

      {/* Portrait mode overlay (mobile only) */}
      {isPortrait && (
        <div
          data-ocid="game.rotate.panel"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(13,33,55,0.97)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            zIndex: 100,
          }}
        >
          <div style={{ fontSize: 72, animation: "spin 2s linear infinite" }}>
            ↻
          </div>
          <p
            style={{
              color: "#FFD700",
              fontSize: 22,
              fontFamily: "'Courier New', monospace",
              fontWeight: "bold",
              textAlign: "center",
              margin: "0 24px",
            }}
          >
            Rotate your device to landscape mode to play!
          </p>
          <p
            style={{
              color: "#87CEEB",
              fontSize: 14,
              fontFamily: "'Courier New', monospace",
              textAlign: "center",
              margin: "0 24px",
            }}
          >
            Turn your phone sideways for the best experience
          </p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

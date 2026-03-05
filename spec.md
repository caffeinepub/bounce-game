# Bounce Game

## Current State
A single-file React + Canvas game (BounceGame.tsx) with:
- 3 levels, physics (gravity, friction, restitution), squash/stretch animation
- Red ball player, brick walls, spikes, golden rings, exit door
- Smooth camera tracking, HUD (rings counter, level number)
- On-screen touch buttons (◀ ▶ ▲) for mobile/touch devices
- Portrait-mode rotate overlay for Android
- requestAnimationFrame game loop
- No sound effects

## Requested Changes (Diff)

### Add
- Web Audio API sound effects synthesized procedurally (no external files needed):
  - Jump: short rising sine/square tone
  - Ring collect: bright ascending chime (multi-tone)
  - Death/spike: low descending buzz + noise
  - Level complete: short victory fanfare (3 ascending tones)
  - Door open (all rings collected): subtle magical shimmer
  - Bounce/land: soft thud when ball hits ground hard enough
- Performance optimizations for lag-free 60fps in browser:
  - Fixed-timestep physics with interpolated rendering (delta time capping)
  - OffscreenCanvas / ImageData caching for static tile backgrounds (pre-render level tiles into an offscreen buffer, repaint only on level load or camera jump)
  - Avoid per-frame shadow redraws; use pre-baked glow images for rings
  - Throttle camera smoothing to prevent jitter on high-refresh displays
  - Use `will-change: transform` on canvas wrapper
  - AudioContext created lazily on first user interaction to avoid browser autoplay block

### Modify
- BounceGame.tsx: integrate sound engine and performance optimizations throughout
- All sound triggers wired to game events: jump, land (hard bounce), ring collect, spike death, fall death, level complete, all-rings-collected (door opens for first time)

### Remove
- Nothing removed

## Implementation Plan
1. Add a `createSoundEngine()` function using Web Audio API that returns play functions for each sound event (all sounds synthesized, zero file downloads)
2. Add AudioContext lazy init (triggered on first keydown/touch to satisfy browser autoplay policy)
3. Add offscreen canvas for tile layer: pre-render all visible tiles to an offscreen buffer on level load; composite it each frame instead of re-drawing each brick
4. Add delta-time accumulator for fixed-step physics (cap delta at 50ms to prevent spiral of death on tab refocus)
5. Wire sound calls into: jump, hard land (vy > 6 before landing), ring collect, spike/fall death, level complete, first-time door unlock
6. Ensure AudioContext is resumed on user gesture (keydown, touchstart)

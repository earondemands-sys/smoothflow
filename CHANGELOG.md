# Changelog

All notable changes to **SmoothFlow Studio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-17

### 🚀 Initial Public Release

#### ✨ Core Features
- **Multi-Scene Motion Timeline Director**:
  - Target Section Selector: Visual element picker with real-time bounding box inspection.
  - "📌 Here" instant viewport capture shortcut.
  - 1-click presets: `Hero ➔ CTA`, `Hero ➔ Middle`, and `Hero ➔ Bottom`.
- **Camera Crane Easing Profiles**:
  - *Cinematic Butter*: Smooth Quintic Bezier ($t^5$).
  - *Ease-In-Out*: Smooth cubic curves.
  - *Gentle Landing*: Cushioned deceleration.
  - *Cruise*: Constant linear glide for scroll-driven animations.
  - *Snappy* & *Spring*: Dynamic mechanical responses.
- **Synchronized 60 FPS / 4K Video Recorder**:
  - Automatic 3-2-1 visual countdown before recording begins.
  - Auto-hides Studio HUD during capture for pristine, studio-grade video.
  - Native browser `MediaRecorder` pipeline with WebM (VP9) and MP4 (H.264) options.
  - Export resolution presets from 720p up to 4K UHD.
  - Instant in-browser video playback modal with one-click download.
- **Virtual Cursor Physics & Visuals**:
  - Spring-damper and linear interpolation (Lerp) algorithms to eliminate erratic hand jitters.
  - 5 customizable cursor styles: `Arrow`, `Classic`, `Dot`, `Ring`, and `Halo`.
  - Contrast-adaptive stroke borders and customizable color palettes.
  - Pulse click ripples and spotlight focus mode.
  - Dynamic idle auto-hiding.
- **Inertial Wheel Scroll Engine**:
  - Replaces jagged mechanical mouse wheel notches with fluid inertial momentum.
- **Frosted Glass Floating Director HUD**:
  - Draggable, collapsible HUD interface.
  - Full keyboard shortcuts:
    - `⌘ + Shift + E` (Win: `Ctrl + Shift + E`): Toggle Studio HUD
    - `⌘ + Shift + S` (Win: `Ctrl + Shift + S`): Play Preview
    - `⌘ + Shift + L` (Win: `Ctrl + Shift + L`): Synchronized Record & Scroll
    - `Esc`: Cancel Picker / Stop Motion
- **Standalone Interactive Demo**:
  - Built-in `demo.html` landing page showcasing full capabilities without external hosting.

# Contributing to SmoothFlow Studio

Thank you for your interest in contributing to **SmoothFlow Studio**! We love community contributions that help make web animations, scrolling, and screen demo recordings effortless.

---

## 🛠️ Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/earondemands-sys/smoothflow.git
   cd smoothflow
   ```

2. **Load into Google Chrome**:
   - Open Chrome and navigate to `chrome://extensions`.
   - Enable **Developer mode** toggle in the top-right.
   - Click **Load unpacked** in the top-left.
   - Select this repository's root directory.

3. **Test with Built-in Demo**:
   - Open `demo.html` directly in Chrome (`file:///path/to/demo.html`).
   - Use shortcuts `⌘ + Shift + E` (Mac) or `Ctrl + Shift + E` (Win/Linux) to open the HUD.

---

## 🧪 Pre-flight Checks

Before submitting a pull request, always run the validation suite:

```bash
# Validates manifest.json, required icon assets, and JS syntax
npm run validate

# Verifies production packaging into dist/
npm run build
```

---

## 📌 Coding Guidelines

- **Vanilla Modern JS**: Keep dependencies minimal. The runtime extension scripts should remain pure vanilla JavaScript without bulky bundlers to ensure instantaneous injection and performance.
- **Manifest V3 Compliant**: Do not use deprecated V2 APIs (`chrome.extension.*`, background pages without service workers, etc.).
- **Performance First**: SmoothFlow hooks into `requestAnimationFrame` and wheel events. Keep frame execution times strictly under 16ms (60 FPS).
- **User Privacy**: SmoothFlow operates 100% locally. Never introduce tracking pixels or external network payloads.

---

## 🤝 Pull Request Process

1. Fork the repo and create your branch from `main`:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. Commit your changes with clear, descriptive commit messages.
3. Push to your branch and open a Pull Request.
4. Ensure all CI checks pass.

---
name: example-webgpu-hero
zh_name: "WebGPU 英雄区"
en_name: "WebGPU Hero"
emoji: "🍜"
description: "Full-bleed WebGPU three.js hero/splash: a flock of mouse-reactive tube 'noodles' animated entirely on the GPU behind an editorial title block and minimal chrome."
zh_description: "全屏 WebGPU three.js 英雄区 / splash：GPU 计算驱动的鼠标交互「面条」管束动画，叠在编辑风标题与极简框架之上。"
en_description: "Full-bleed WebGPU three.js hero/splash: a flock of mouse-reactive tube 'noodles' animated entirely on the GPU behind an editorial title block and minimal chrome."
category: prototype
scenario: design
featured: 60
tags: ["webgpu", "three.js", "hero", "splash", "shader", "generative", "background"]
example_id: sample-webgpu-hero
example_name: "WebGPU 英雄区 · OMMA"
example_format: html
example_tagline: "GPU 面条流"
example_desc: "TSL 计算着色器驱动的管束 + 3D 标题淡入 + 鼠标视差"
od:
  mode: prototype
  surface: prototype
  scenario: design
  platform: desktop
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the WebGPU Hero template to turn my content into a full-bleed splash page with a live three.js GPU-animated background behind an editorial title block. Preserve the template's visual signature and WebGPU pipeline, use real copy, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「WebGPU 英雄区」模板把我的内容做成一个全屏 splash：实时 three.js GPU 动画背景 + 编辑风标题。保持模板的视觉签名和 WebGPU 管线，使用真实文案，避免 lorem ipsum 和占位图片。"
---

# WebGPU Hero Skill

Produce a single, self-contained HTML splash page: a full-viewport WebGPU
three.js animation rendered behind an editorial title block and thin chrome.
Start from the bundled `example.html` and **edit** it — do not rewrite the
shader pipeline from scratch.

## What ships

```
example-webgpu-hero/
├── SKILL.md          ← you're reading this
├── open-design.json  ← marketplace manifest
└── example.html      ← baked seed: full WebGPU pipeline + chrome (READ FIRST)
```

## How it works (so you know what is safe to touch)

The seed is one HTML file with three layers:

1. **Chrome (HTML + CSS)** — the title block (`.title-block h1` / `.tagline`),
   top nav (`.logo` / `.nav-links`), `.badge`, side labels, `.bottom-bar`,
   corner frames, and the radial-gradient `body` background. Plain markup you
   can freely rewrite.
2. **The 3D background (`<script type="module">`)** — a three.js WebGPU renderer
   driving a flock of tube "noodles" along Catmull-Rom flight paths, animated
   entirely on the GPU via TSL compute passes (spine → centroids → boids
   repulsion → parallel-transport frames → tube vertices). A `params` object at
   the top is the single source of truth for every tunable value; a `lil-gui`
   panel (toggle with the `P` key) exposes them live.
3. **3D title text** — the `<h1>` is mirrored as extruded `TextGeometry` that
   fades/slides in once the Space Grotesk font loads, kept aligned to the DOM
   `<h1>` via `updateTextScale()`.

Dependencies load from a CDN `importmap` (three.js 0.183, stats-gl, lil-gui).
Keep the script inline and keep the importmap — the preview runs in a
null-origin sandbox, so a separate `/index.js` or bare relative import would
not resolve.

## Workflow

1. **Read the seed** end to end. Note the `params` block, `PALETTE`, and the
   chrome class names above.
2. **Rebrand the chrome** — replace `<title>`, `.logo`, `.nav-links`, `.badge`,
   `.title-block h1`, `.tagline`, side labels, and `.bottom-bar` with the user's
   real copy. No filler — every slot carries a real word.
3. **Match the 3D title** — update the `TextGeometry('OMMA', …)` string to the
   new headline so the extruded text matches the DOM `<h1>`. For a long
   headline, delete the `textMesh` block + font-load `.then` and rely on the CSS
   `<h1>` alone.
4. **Tune the look via `params` only** — palette via `PALETTE`; background via
   `bgColorCenter` / `bgColorEdge` (mirror in the CSS `body` gradient);
   density/shape via `noodleCount` / `tubeRadius` / `pathFraction`; material via
   `roughness` / `metalness` / `clearcoat` / `colorGradientMix`; feel via
   `mouseForce` / `separationAmplitude` / `parallaxAmountX/Y`. Leave the
   compute-shader bodies alone unless changing the motion model itself.
5. **Self-check** — single HTML file; module stays inline; importmap intact;
   `navigator.gpu` guard + `.gpu-fallback` present; CSS gradient matches the
   `bg*` params; 3D-text string equals the `<h1>` (or both 3D-text blocks
   removed); no filler; one clear accent.
6. **Emit the artifact** — wrap the final HTML in `<artifact>` with a kebab-case
   `identifier`. One sentence before; nothing after.

## Hard rules

- **WebGPU only.** Keep the `navigator.gpu` guard and `.gpu-fallback` message —
  never ship a blank screen on unsupported browsers.
- **Single inline module + CDN importmap.** No external `.js`, no bundler.
- **`params` is the only knob surface.** Tune visuals there, not deep in the GPU
  passes.
- **Chrome stays minimal.** Thin nav, one badge, editorial title — the 3D layer
  is the hero; don't crowd it.
- **Keep first paint dark.** The CSS gradient must match the WebGPU clear so
  there's no flash before the canvas initializes.

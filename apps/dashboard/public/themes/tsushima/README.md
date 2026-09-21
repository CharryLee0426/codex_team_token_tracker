# Tsushima theme artwork

*中文说明：[README.zh-CN.md](./README.zh-CN.md)*

Original AI-generated decorative artwork created for the dashboard's Ghost of Tsushima-inspired theme on 2026-09-21 using the built-in OpenAI image generation tool. It is not an official game screenshot, promotional image, or licensed game asset. No external image, font, or audio assets were incorporated.

The artwork is language-neutral: it contains no text, branding, or interface elements, so the same files support English and Simplified Chinese. The moonlit island scene uses ivory susuki grass, crimson maple leaves, charcoal silhouettes, and blue-gray mist. Dashboard surfaces supply the contrast needed for interface text.

At runtime, the landscape is one layer of an animated scene: a transparent canvas draws independent windblown maple leaves, moving mist and swaying grass, while the landscape responds gently to mouse movement and scrolling. These effects are generated locally in code, with no video, audio or additional media downloads. Background motion can be paused from the dashboard header or Settings, and automatically respects reduced-motion preferences and hidden tabs.

| File | Dimensions | Bytes | Purpose |
| --- | --- | ---: | --- |
| `landscape.webp` | 1672 × 941 | 182644 | Desktop background |
| `landscape-mobile.webp` | 960 × 540 | 69218 | Smaller-screen background |
| `preview.webp` | 480 × 270 | 23542 | Theme picker preview |

The generation request asked for 3840 × 2160 if supported; the tool returned 1672 × 941. These assets preserve that original resolution rather than upscaling. A second built-in image generation pass removed an unwanted signature-like mark from the bottom-right corner. The approved image was encoded as WebP with Sharp (quality 88 for desktop, 82 for mobile and preview, effort 6). Smaller variants are proportionally resized; no creative edits or recoloring were applied outside the image generation tool. No audio is included.

## Exact generation prompt

```text
Use case: stylized-concept.
Asset type: premium widescreen decorative landscape background for a readable web dashboard theme inspired by Ghost of Tsushima.
Primary request: create an original cinematic landscape painting of a Japanese island, wind sweeping through delicate ivory susuki pampas grass in the foreground, with a sculptural crimson Japanese maple anchoring the right edge, layered blue-gray mountains and a tranquil inlet dissolving into luminous mist. A tiny lone samurai silhouette may stand near the far-right maple only if compositionally natural, very small and understated.
Style/medium: exquisite high-end environment concept art, realistic atmospheric depth with restrained Japanese ink-painting sensibility, finely detailed natural textures, editorial art direction, cinematic still.
Composition/framing: wide 16:9 landscape, 3840 by 2160 if supported. Keep the left two thirds and center tranquil and low-detail: soft mist, broad distant silhouettes, gentle water, generous negative space. Wind-blown grass concentrated toward the bottom, richly detailed maple leaves toward the upper and far-right perimeter. Most visual interest around the edges, beautiful when cropped for portrait mobile displays. No close-up characters.
Lighting/mood: soft overcast moonlit twilight, tranquil and contemplative, subtle silver rim light on ivory grass and drifting maple leaves, atmospheric haze, no bright sun or blown-out sky.
Color palette: dark charcoal ink, desaturated blue-gray mist, warm ivory grass, muted antique gold highlights, rich restrained vermilion and oxblood maple leaves.
Constraints: this is scenic art only, no interface, frames, words, letters, calligraphy, logo, watermark, signage, or audio. Original artwork; no recreation of existing promotional art, screenshots, or identifiable game characters. Avoid neon, overly saturated colors, busy center, strong grain, lens flare, or artificial blur.
```

## Exact cleanup prompt

```text
Use case: precise-object-edit.
Edit target: the provided moonlit island landscape.
Change only this: remove the small pale gray signature/logo-like scribble at the extreme bottom-right corner, replacing those few pixels with the naturally matching dark grass and soil.
Keep everything else identical: framing, dimensions, moon, clouds, islands and distant mountain, water, red maple tree and leaves, tiny samurai, ivory pampas grass, lighting, color, detail, textures, and overall composition. Do not add any signature, watermark, logo, symbol, lettering, or text anywhere.
```

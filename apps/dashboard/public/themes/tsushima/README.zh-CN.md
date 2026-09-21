# 对马岛主题插画

*English: [README.md](./README.md)*

这幅原创 AI 装饰插画于 2026-09-21 使用 OpenAI 内置图像生成工具创作，用于仪表盘中受《对马岛之魂》启发的主题。它不是官方游戏截图、宣传图片或经授权的游戏素材。未使用任何外部图片、字体或音频素材。

插画不含文字、品牌标识或界面元素，同一套图片适用于英文和简体中文。月夜海岛场景采用象牙白芒草、朱红枫叶、墨色剪影与蓝灰薄雾；界面文字的对比度由仪表盘面板保证。

运行时，插画是动态场景中的一层：透明画布独立绘制随风飘动的枫叶、流动薄雾和摇曳草叶，风景则随鼠标移动和页面滚动产生轻微视差。所有动效均由本地代码生成，不包含视频、音频或额外媒体下载。可通过顶部栏或设置暂停背景动效；系统的减少动态效果偏好和标签页隐藏状态也会自动生效。

| 文件 | 尺寸 | 字节数 | 用途 |
| --- | --- | ---: | --- |
| `landscape.webp` | 1672 × 941 | 182644 | 桌面背景 |
| `landscape-mobile.webp` | 960 × 540 | 69218 | 小屏幕背景 |
| `preview.webp` | 480 × 270 | 23542 | 主题选择器预览 |

生成请求提出在支持的情况下使用 3840 × 2160 分辨率，工具实际返回 1672 × 941。素材保留原始分辨率，没有进行放大。第二次内置图像生成操作移除了右下角一处不需要的类签名标记。确认后的图片通过 Sharp 编码为 WebP（桌面质量为 88，移动端和预览质量为 82，effort 为 6）。小尺寸文件仅按比例缩小，未在图像生成工具之外进行创意修改或重新着色。不包含音频。

## 原始生成提示词

以下英文提示词为实际提交内容，原样保留：

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

## 原始清理提示词

```text
Use case: precise-object-edit.
Edit target: the provided moonlit island landscape.
Change only this: remove the small pale gray signature/logo-like scribble at the extreme bottom-right corner, replacing those few pixels with the naturally matching dark grass and soil.
Keep everything else identical: framing, dimensions, moon, clouds, islands and distant mountain, water, red maple tree and leaves, tiny samurai, ivory pampas grass, lighting, color, detail, textures, and overall composition. Do not add any signature, watermark, logo, symbol, lettering, or text anywhere.
```

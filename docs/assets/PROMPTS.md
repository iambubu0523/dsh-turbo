# 配图生成提示词（Image prompts）

> 当前仓库里的 `hero.jpg` / `social.jpg` / `mascot.png` 是作者用社区公开的角色描述提示词生成的成品（豆包出图），没有任何第三方图片素材被复制进仓库。
> 想换成别的版本时，用下面的提示词重新生成，按同名覆盖 `docs/assets/` 即可；`hero` / `social` 请保持**图内无字**，标题由代码叠加。
>
> 角色「鲸鱼娘」为社区共创设定；本文件的中文提示词改写自 [deepseek-whale-girl](https://github.com/TreapGoGo/deepseek-whale-girl) 社区公开描述（该文本按 CC BY-SA 4.0 共享），图片为本项目自行生成。

## 一、角色设定（先统一人设，再生成图）

社区对 DeepSeek 鲸鱼的拟人化形象（"鲸鱼娘"）已经有一套公认特征，参考
[deepseek-whale-girl 社区资产库](https://github.com/TreapGoGo/deepseek-whale-girl)。
本项目沿用以下 4 个识别点，保证和大家的二创"一看就是一家人"：

1. **蓝白鲸鳍状耳**（是身体结构，不额外长人耳）
2. **深蓝 → 浅蓝渐变的蓬松长卷发**，头顶一根呆毛
3. **蓝色瞳孔**
4. **一条蓝色鲸尾，尾端分双叶**（不是两条尾巴）

性格基调：元气、爱笑、有点憨；配色永远围绕 深海军蓝 + 蓝 + 青 + 琥珀黄。

## 二、README 头图（16:9，最常用）

**尺寸**：2048×972（或 1920×1080）
**要求**：**不要任何文字**（文字由我后期叠上去，模型写中文必糊）

```
Official GitHub README hero banner, 16:9 wide composition.

RIGHT SIDE (about 45% of canvas): a chibi anime whale-girl mascot, super-deformed
proportions (big head, small body). Deep-blue to light-blue gradient fluffy long
wavy hair with a single ahoge; whale-fin shaped ears instead of human ears; big
sparkling blue eyes with star highlights; rosy cheeks; small happy open smile.
She wears a navy-and-white hoodie with a tiny yellow lightning bolt emblem, and a
blue whale tail with a double-lobed fluke curves out behind her. She rides a
stylized crescent wave, one arm raised holding a glowing amber lightning bolt.

LEFT SIDE: clean empty deep-navy space (#0A1024) with a faint dot grid and a soft
blue radial glow, deliberately left blank for typography.

STYLE: flat vector illustration with cel-shaded anime highlights, crisp clean
outlines, soft edge glow, high contrast, brand palette deep navy #0A1024 /
azure #4D9BFF / cyan #56E1E9 / amber #FFC53D. Slight sparkle particles.

NO TEXT, NO LETTERS, NO WATERMARK, NO LOGO.
```

## 三、头像 / 独立吉祥物（1:1，透明底）

**尺寸**：1024×1024
**格式**：**PNG 带 alpha 通道**（背景必须真透明，不要白底）

```
Chibi anime whale-girl mascot sticker, 1:1, full body, 3/4 view facing viewer,
waving one hand cheerfully.

Deep-blue to light-blue gradient fluffy long wavy hair with ahoge; whale-fin ears;
big sparkling blue eyes; rosy cheeks; tiny smile.
Navy-and-white hoodie with a small amber lightning bolt on the chest;
blue whale tail with double-lobed fluke.

STYLE: chibi sticker, thick clean white outer stroke, cel shading, flat colors,
soft inner glow, transparent background, centered, generous padding.

NO TEXT, NO WATERMARK.
```

## 四、社交预览图（1280×640）

**用于** GitHub → Settings → Social preview。

```
Social share card, 1280x640, deep navy background with subtle dot grid and a soft
blue glow bottom-right. Right side: chibi anime whale-girl riding a wave with an
amber lightning bolt. Left side: empty space reserved for the project title.
Flat vector, cel-shaded, crisp outlines, brand palette #0A1024 / #4D9BFF / #56E1E9
/ #FFC53D. NO TEXT, NO TEXT AT ALL.
```

## 五、插件图标（1:1，可替代 icon.svg）

```
App icon, rounded-square, 1024x1024. A cute chibi whale head (blue gradient, big
sparkling eyes, whale-fin ears) with a bold amber lightning bolt diagonally across
the upper right. Flat vector, thick clean shapes, subtle inner shadow, deep navy
background with rounded corners, generous padding.

NO TEXT.
```

## 六、负面提示词（通用，务必带上）

```
text, letters, watermark, signature, logo, extra fingers, extra tails, deformed
hands, photorealistic, 3d render, plastic, blurry, low contrast, muddy colors,
gray palette, busy noisy background, human ears visible, two tails, two mouths
```

## 七、如果你想保留"纯鲸鱼"路线（不拟人）

```
Cute cartoon whale mascot, chibi proportions, round body, big glossy eyes, tiny
flippers, blue gradient skin with lighter belly, a small whale spout, riding a
wave, one amber lightning bolt beside it. Flat vector, cel shading, thick white
sticker outline, transparent background. NO TEXT.
```

## 八、拿到图之后

1. 覆盖到对应位置（文件名不要改，README 用的是固定路径）：
   - `docs/assets/hero.jpg` —— 头图，无字，左侧留白 45%
   - `docs/assets/social.jpg` —— 社交预览，1280×640
   - `docs/assets/mascot.png` —— 透明底头像，1024×1024
   - `docs/assets/avatar.png` —— 仓库方形头像，512×512，头部特写
   - `icon.png` —— 插件面板图标，256×256，圆角深色底
2. 告诉我，我负责重新叠字、压体积并提交推送（`git add -A && git commit && git push`）。
3. 文字由代码叠加，不要在生成图里写字 —— 中文几乎一定糊。

## 授权提醒

生成的图请确认你对该图有使用权（自建模型/SD 本地跑一般没问题；商用图库模型的输出条款要先看清楚），
再放进公开仓库。本项目 `LICENSE` 只覆盖代码与文档，不覆盖第三方生成的图像资产。

# 便携制作与执行

需求已收齐、`STYLE_CONTRACT.md` 与 `PRODUCTION_PROMPT.md` 已完成自检后进入本阶段。项目目录与技能目录分开，所有创作文件、素材、渲染、依赖及日志在项目内；包内工具和资料通过 SKILL_ROOT 的实际位置读取。

## 环境与路线

优先复用用户工程及其经过核实的构建命令。普通二维代码视频可走本包的确定性 HTML → Playwright → FFmpeg 路线；需要场景与光照时可用 Three.js；已有 Remotion 项目按帧驱动；复杂建模、物理或材质有必要且环境可用时使用 Blender；数学教学可用 Manim。只选本片真正需要的一套主路线，不同时搭建多套框架。

读 [video.mjs 接口](../scripts/README.md)。标准渲染工具需要 Node.js 22+、FFmpeg 与 FFprobe、Playwright 及 Chromium。Python、Blender、Manim、TTS 和额外字体／采样仅在相应内容需要时添加；原文中的版本和操作系统是参考，不是当前系统事实。

从任意工作目录运行，以下 `<SKILL_ROOT>` 和 `<PROJECT>` 替换为实际绝对路径并作为单独参数传递：

```text
node <SKILL_ROOT>/scripts/video.mjs doctor <PROJECT>
```

复用兼容依赖；缺少标准运行时依赖时可在包的 `assets/runtime` 单独安装。该目录是发行工具的依赖目录，项目内容仍放项目内：

```text
npm --prefix <SKILL_ROOT>/assets/runtime ci --ignore-scripts
node <SKILL_ROOT>/assets/runtime/node_modules/playwright/cli.js install chromium
```

Playwright 固定版本与锁文件随包，浏览器及 node_modules 不随 ZIP 分发。首次安装需联网；doctor 只检查，不自动下载或改系统配置。系统工具由用户环境提供，安装系统级工具、付费服务及其他操作遵守用户授权和宿主权限。只读安装目录不能写时，可在项目安装同版本 Playwright，渲染器优先支持项目依赖，见工具说明。使用参数化子进程，给空格路径正确传参，避免拼接 shell 命令。

## 项目与时间轴

为每片新建独立目录，至少包括 `BRIEF.md`、`brief.json`、`STYLE_CONTRACT.md`、`PRODUCTION_PROMPT.md`、`TREATMENT.md`、素材来源、源码、构建入口与 `outputs/`。配置保存画幅、fps、总帧数、语言和内容，避免散落的重复数值。

`TREATMENT.md` 先围绕用户题材确定结构、开场、转折、标志镜头和结尾，再参考实现技法。短片与长片按信息密度分配节奏；固定相机、抽帧、硬切等来自所选风格，不被通用建议替换。角色片建立造型与姿势一致性，无角色片直接验证关键构图。

统一时间轴记录镜头、动作、音乐节拍、音效、语句和字幕。规定时间用秒还是帧，转换只在一处；实际音频生成后以实测时长更新相关镜头和字幕。用原文要求与素材边界完成核心效果后再扩全片。

## HTML 页面的渲染合同

`index.html` 提供：

```js
window.READY = true; // 或资源加载完成的 Promise；字体、图片和模型已就绪
window.renderAt = async (t) => {
  // 每次从 t 计算完整画面；任意顺序调用均得到同一结果。
};
```

渲染器也兼容 `window.render(t)`／`window.seek(t)`。页面尺寸从实际 viewport 取得。资源相对项目目录，浏览器由工具本地服务；复杂项目需要独立构建时先产出可服务的页面。时间函数等待异步更新完成再截图；固定随机种子，物理预计算或缓存，不依赖之前渲染哪帧。输出fps、有效角色采样与相机采样分别定义。

渲染器逐帧调用并截图，不录制实时播放。先用 still 看开场、关键转场、标志镜头和结尾，再渲染低清运动与正式母版：

```text
node <SKILL_ROOT>/scripts/video.mjs still <PROJECT> --time 1 --width 1280 --height 720 --out outputs/keyframe.png
node <SKILL_ROOT>/scripts/video.mjs render <PROJECT> --width 1920 --height 1080 --fps 30 --duration 10 --out outputs/video.mp4
```

这些数字只是命令示例，执行时替换为本片规格。工具拒绝覆盖既有输出，改用版本文件名。严格整数总帧数，不用 `-shortest` 掩盖音画长度不一致。透明视频或其他编码路线自行补对应构建命令，并验证实际 alpha，不能宣称标准 H.264 含透明通道。

## 声音与字幕

以需求表声音选择为准：无声项目跳过音轨；有已有音频时按许可范围保留；有配音需求时选择可用语言和引擎，在项目内生成并实测。中文可在用户允许联网时采用项目虚拟环境的 edge-tts，离线方案先核查目标语言质量和模型资源；密钥由用户环境提供，不写进提示词或源码。

音符、乐器事件和程序化音效可由 Python 标准库／NumPy 或 Web Audio 离线计算生成 WAV；采样需要记录来源。不同声部共用 timeline，音效触发或可感知峰值对应画面事件；听感校验与客观测量结合。配音逐句复听数字术语，转写只能辅助，不能为了过 ASR 改坏正确台词。

字幕来自最终语音与实测时间，样式属于主风格，实际字体测量后拆句。保证阅读与主体无遮挡，有字幕交付 SRT；按用户需要内嵌字幕。

有音轨时先完成混音与目标响度，再将 WAV 通过 `render --audio <project-relative-path>` 接入，或在相应工具链 mux。标准工具负责音轨长短对齐而不负责创作和母带：不足补静音、超长按片长截取的行为须与时间表一致，尾音另留设计时间。用最终文件实测约定 LUFS、真峰值、语音可懂度与同步，不能只信中间音轨。

## 进入验收

以真实代码验证风格帧、关键动作和全片运动后，完整导出所需分辨率。制作过程中保持版本及素材来源。按 [quality.md](quality.md) 检查最终文件和工程；用户需要审阅的节点按 brief 停下，其余修复持续完成。

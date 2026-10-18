# Code Video Studio

[下载最新 Skill ZIP](https://github.com/jiongwang114/code-video-studio/releases/latest/download/code-video-studio-1.0.0.zip) · [版本与校验文件](https://github.com/jiongwang114/code-video-studio/releases) · [全部66份风格](references/library/CATALOG.md) · [制作提示词模板](references/production-prompt.md)

一个可独立安装的纯代码视频 skill：先展示完整需求表，再使用随包的 **15 份 MG 提示词与 51 份影片风格原文**，完成制作提示词、代码、渲染、验收和交付。

包内资料和工具全部按安装目录定位。无需原作者电脑、个人目录、ChatCut、其他本地 skill、API Key 或付费生成模型。它需要一个能读写项目文件、执行命令并检查画面的 AI 编程助手；视频渲染需要下列本地工具。完整资料库可以离线查阅。

## 安装与调用

1. 从 [GitHub Releases](https://github.com/jiongwang114/code-video-studio/releases/latest) 下载 Skill ZIP 并解压，保留整个 `code-video-studio/` 文件夹，不要只拿 `SKILL.md`。
2. 将该文件夹放入宿主支持的 skills 目录。Codex 可使用其配置的用户技能目录，例如 `~/.codex/skills/code-video-studio/`；其他支持 Agent Skills 的助手按各自技能目录安装。也可以先让助手读取解压目录内的 `SKILL.md` 来使用，资料仍需完整保留。
3. 在 Codex 中输入 **`$code-video-studio`**，或从技能列表选择。支持 slash 技能调用的宿主可使用 **`/code-video-studio`**；调用符号由宿主决定，不是 ZIP 自己注册命令。

本项目安装可将完整文件夹放到 `.agents/skills/code-video-studio/`。也可以在目标项目中直接克隆：

```sh
git clone https://github.com/jiongwang114/code-video-studio.git .agents/skills/code-video-studio
```

入口：[SKILL.md](SKILL.md)。若新安装后列表没有更新，按宿主的技能刷新／重开会话方式加载。

## 第一次使用

只调用名称时，AI 先输出完整12项需求表，并标记：

- **已填写**：从对话里提取的用户明确回答。
- **待填写**：尚未回答或存在关键缺项。
- **由 AI 决定**：用户明确委托选择。
- **不适用**：已确定本次不需要。

建议值独立展示。用户一次性补充后，AI 更新同一份完整表。必要信息齐备或明确委托其余事项后，连续完成：

**读取原文 → 选主风格并处理冲突 → 填完11项制作提示词并自检 → 分镜与代码草稿 → 声音字幕 → 正式渲染 → 验收修改 → 交付。**

默认制作到成片。也可以明确说“本轮只要制作提示词”或“只做分镜”；需要审阅故事板时在需求表注明，AI 会在那个节点等反馈。

## 运行环境

| 用途 | 所需工具 |
|---|---|
| 读取需求和风格、生成制作提示词 | 支持文件读取的 AI 助手 |
| 随包 HTML 渲染器 | Node.js 22+、FFmpeg、FFprobe、Playwright、Chromium |
| 配音、代码音频、特定数据处理 | 按项目需要添加 Python 与相关包；已有音频或无声项目可省略 |
| Blender／Manim／Remotion 等特殊路线 | 仅按所选风格、工程和实际环境安装 |

系统工具安装后应可从 PATH 调用。Playwright 的固定依赖文件随包，浏览器与 node_modules 为避免体积和平台绑定未放入 ZIP。首次渲染安装一次依赖即可；有兼容环境时优先复用。没有必需工具时 skill 会说明缺项，不会把仅有计划报告为成片。

从解压后的技能目录执行：

```sh
npm --prefix assets/runtime ci --ignore-scripts
node assets/runtime/node_modules/playwright/cli.js install chromium
node scripts/video.mjs doctor
```

`doctor` 只检查，不下载。只读技能安装目录可在独立项目安装匹配版本 Playwright，见 [渲染器接口](scripts/README.md)。命令在 Windows、macOS、Linux 使用同一 Node 脚本，环境变量的设置语法按操作系统调整。当前发行在 Windows 实测；其他系统尚未实测。

随包 `assets/runtime/demo/` 是工具 smoke test 页面，不是风格样片或默认视频模板。实际创作由 AI 依据需求与原文编写。

## 包含的文件

- [references/intake.md](references/intake.md)：完整需求表与状态规则；[assets/brief.schema.json](assets/brief.schema.json) 为机器可读需求结构。
- [references/library/CATALOG.md](references/library/CATALOG.md)：66份原文索引；包含上游固定提交和许可。
- [references/selection.md](references/selection.md)：原文约束提取与冲突处理。
- [references/production-prompt.md](references/production-prompt.md)：11项最终制作提示词及生成前自检。
- [references/production.md](references/production.md)、[references/quality.md](references/quality.md)：制作与验收交付。
- [scripts/README.md](scripts/README.md)：环境检查、单帧、逐帧视频和规格验证工具。

原文是完整文字快照；上游样片、专用 demo 引擎、字体、TTS 模型和素材不在包内。原文保留的相关引用已登记在 [LINK_REPORT.md](references/library/LINK_REPORT.md)。制作使用随包工具或实际核实后的其他工具链。

## 纯代码与素材

画面和运动由代码制作，不调用生图／生视频模型。是否完全零外部可见素材由用户决定：字体、音源、数据、照片、扫描和模型分别注明。需要真实证据的实证风格必须有实际来源，不能用程序生成假材料代替。

自定义视频的风格质量依赖所用 AI、题材、可用环境和检查修改。随包工具的测试证明基础渲染链路可工作，不代表66种风格均已复现，也不保证任意项目一次完成。

## 许可与来源

本包新增工作流、工具与文档使用 [MIT](LICENSE)。所携带的两套上游文字资料各保留原 MIT 许可及版权，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。没有打包其样片、音乐、图像、字体或其他第三方素材；未来项目采用的素材单独登记许可。

验证范围和实际限制见 [VALIDATION.md](VALIDATION.md)。

## 校验与重新打包

Release 同时提供 ZIP 和 SHA-256 校验文件，ZIP 内的 `MANIFEST.sha256` 记录逐文件校验和。源码目录可使用 Python 3.10+ 重新核验或打包：

```sh
python scripts/package.py --check
python scripts/package.py
```

本地打包输出到 `dist/`，包含同名顶层 skill 文件夹。GitHub Actions 核验资料来源、包内链接、清单与 Node 语法和锁定依赖。

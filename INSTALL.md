# Installation guide / دليل التثبيت

Step-by-step installation of the `persistent-memory` plugin for Claude Code, on Windows, macOS and Linux.
خطوات تثبيت إضافة `persistent-memory` في Claude Code على Windows وmacOS وLinux.

**Contents / المحتويات**
1. [Requirements / المتطلبات](#1-requirements--المتطلبات)
2. [Terminal vs. shell on Windows / الفرق بين Terminal وShell](#2-terminal-vs-shell-on-windows--الفرق-بين-terminal-وshell)
3. [Install Claude Code / تثبيت Claude Code](#3-install-claude-code--تثبيت-claude-code)
4. [Install the plugin / تثبيت الإضافة](#4-install-the-plugin--تثبيت-الإضافة)
5. [Enable auto-update / تفعيل التحديث التلقائي](#5-enable-auto-update--تفعيل-التحديث-التلقائي)
6. [Verify / التحقق](#6-verify--التحقق)
7. [Claude desktop app and duplicate copies / تطبيق Claude ونسخ مكررة](#7-claude-desktop-app-and-duplicate-copies--تطبيق-claude-ونسخ-مكررة)
8. [Troubleshooting / حل المشكلات](#8-troubleshooting--حل-المشكلات)
9. [Update manually or uninstall / التحديث اليدوي والإزالة](#9-update-manually-or-uninstall--التحديث-اليدوي-والإزالة)

---

## 1. Requirements / المتطلبات

| Requirement / المطلوب | Why / السبب |
|---|---|
| A Claude subscription (Pro or higher) / اشتراك Claude | Needed to sign in to Claude Code / لتسجيل الدخول في Claude Code |
| **Git** | Claude Code clones the plugin from GitHub. Without it: `Command 'git' not found` / لنسخ الإضافة من GitHub |
| **Node.js** (LTS) | The plugin's hooks and the `memory-lint`, `memory-doctor`, `memory-activity` skills run on Node. Without it: `Executable not found in $PATH: "node"` / تعمل به الـhooks وبعض المهارات |

### Install Git / تثبيت Git

| System | Command / الأمر |
|---|---|
| Windows | `winget install --id Git.Git -e --source winget` (or download from https://git-scm.com/download/win and keep the default options / أو نزّله من الموقع واترك الخيارات الافتراضية) |
| macOS | `xcode-select --install` (or `brew install git` if you use Homebrew) |
| Debian / Ubuntu | `sudo apt update && sudo apt install -y git` |
| Fedora | `sudo dnf install -y git` |

### Install Node.js / تثبيت Node.js

| System | Command / الأمر |
|---|---|
| Windows | `winget install OpenJS.NodeJS.LTS -e --source winget` (or download the LTS installer from https://nodejs.org / أو نزّله من الموقع) |
| macOS | `brew install node` (or the LTS installer from https://nodejs.org) |
| Linux | Use the LTS installer or instructions from https://nodejs.org/en/download, because the version in some distro repositories is too old / لأن نسخة بعض المستودعات قديمة |

**Important / مهم:** after installing, **close the terminal and open a new one**, then check:
بعد التثبيت أغلق الطرفية وافتحها من جديد، ثم تحقق:

```
git --version
node --version
```

Both must print a version number. / يجب أن يظهر رقم إصدار لكل منهما.

If `winget` is not recognized on Windows, use the download links above.
إذا لم يعمل `winget` فاستخدم روابط التنزيل أعلاه.

---

## 2. Terminal vs. shell on Windows / الفرق بين Terminal وShell

- **Windows Terminal** is the *window* (tabs, fonts, colors). It does not understand commands itself.
  **Windows Terminal** هي النافذة فقط (التبويبات والخطوط)، ولا تنفّذ الأوامر بنفسها.
- A **shell** is the *program inside the window* that reads and runs your commands. On Windows there are two you are likely to meet:
  الـ **Shell** هو البرنامج داخل النافذة الذي يقرأ الأوامر وينفّذها. في Windows ستقابل غالباً نوعين:

| Shell | How to recognize it / كيف تعرفه | Notes |
|---|---|---|
| **PowerShell** | The prompt starts with `PS C:\...>` | Default in Windows Terminal. Use this one / الافتراضي، استخدمه |
| **Command Prompt (CMD)** | The prompt is `C:\...>` with no `PS` | Older shell; some commands differ / أقدم وبعض الأوامر تختلف |

So "open Terminal" and "open PowerShell" usually lead to the same place: Windows Terminal running PowerShell. The Claude Code installer command differs by shell (see step 3), so check your prompt first.
لذلك فتح Terminal وفتح PowerShell يوصلانك عادةً إلى المكان نفسه. أمر تثبيت Claude Code يختلف حسب الـ shell، فانظر إلى بداية السطر أولاً.

**Tips / نصائح**
- Do not run Claude from `C:\WINDOWS\system32`. Open a normal (non-Administrator) window and run `cd ~` first.
  لا تشغّل Claude من `C:\WINDOWS\system32`؛ افتح نافذة عادية (بدون Administrator) ونفّذ `cd ~` أولاً.
- To paste in PowerShell, right-click or press `Ctrl+V`. Make sure no stray character is pasted at the end of the line.
  تأكد ألا يُلصق حرف زائد في آخر السطر.

On macOS and Linux the "shell" is usually zsh or bash and runs inside Terminal; the commands below work as they are.
في macOS وLinux الـ shell غالباً zsh أو bash داخل Terminal، والأوامر أدناه تعمل كما هي.

---

## 3. Install Claude Code / تثبيت Claude Code

**Windows, PowerShell (`PS` prompt):**

```powershell
irm https://claude.ai/install.ps1 | iex
```

**Windows, Command Prompt (CMD):**

```cmd
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

**macOS / Linux:**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

If the installer says the install folder is not in your `PATH` (Windows: `C:\Users\<you>\.local\bin`), add it. In PowerShell:
إذا ذكر المثبّت أن المجلد غير موجود في PATH فأضفه. في PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$env:USERPROFILE\.local\bin", "User")
```

Then close and reopen the terminal. On macOS/Linux, if `claude` is not found, add `~/.local/bin` to your PATH in `~/.zshrc` or `~/.bashrc`.
ثم أغلق الطرفية وافتحها من جديد.

Start Claude Code from your home folder and sign in:
شغّل Claude Code من مجلدك الرئيسي وسجّل الدخول:

```
cd ~
claude
```

First run: pick a theme (Enter), choose **Claude account with subscription**, sign in in the browser, and answer **Yes** to "Do you trust the files in this folder?".
أول تشغيل: اختر الثيم، ثم **Claude account with subscription**، وسجّل الدخول في المتصفح، وأجب **Yes** عن سؤال الثقة بالمجلد.

---

## 4. Install the plugin / تثبيت الإضافة

Type these inside Claude Code (not in PowerShell/bash), one at a time:
اكتب هذين الأمرين داخل Claude Code وليس في الـ shell، واحداً تلو الآخر:

```
/plugin marketplace add msamkari/samkari-plugins
/plugin install persistent-memory@samkari-plugins
```

- Choose **Install for you (user scope)**: the plugin is then available in every folder.
  اختر **Install for you (user scope)** لتتوفر الإضافة في كل المجلدات.
- **Memory folder** (plugin option): the local folder that holds your `Persistent_Memory_System` files, for example a synced Dropbox folder such as `C:\Users\<you>\Dropbox\Persistent_Memory_System`. It is **optional**: it is only used by the session-start index hook. Leave it empty if unsure and press **Save configuration**; you can change it later from `/plugin` → Installed → persistent-memory → Configure options.
  حقل **Memory folder** اختياري، ويُستخدم فقط لفهرس بداية الجلسة. اتركه فارغاً إن لم تكن متأكداً، وغيّره لاحقاً من `/plugin` ← Installed ← persistent-memory ← Configure options.

---

## 5. Enable auto-update / تفعيل التحديث التلقائي

1. Type `/plugin`. / اكتب `/plugin`.
2. Go to the **Marketplaces** tab (arrow keys). / انتقل إلى تبويب **Marketplaces**.
3. Select **samkari-plugins**. / اختر السوق.
4. Select **Enable auto-update**. / اختر **Enable auto-update**.

When enabled, the screen shows **"Auto-update enabled. Claude Code will automatically update this marketplace and its installed plugins."** and the menu item changes to **Disable auto-update**. Do not press it unless you want to turn updates off.
عند التفعيل تظهر العبارة أعلاه ويتحول الزر إلى **Disable auto-update**؛ لا تضغطه إلا إذا أردت إيقاف التحديث.

Note for maintainers: a new version reaches users when `version` in `.claude-plugin/plugin.json` is raised, so bump it with every published change.
ملاحظة للمشرفين: يصل الإصدار الجديد للمستخدمين عند رفع `version` في ملف `plugin.json`، فارفعه مع كل تعديل منشور.

---

## 6. Verify / التحقق

1. `/plugin` → **Installed**: `persistent-memory @ samkari-plugins`, Status **Enabled**, with the current version (see `plugin.json`).
   يجب أن تظهر الإضافة مفعّلة بالإصدار الحالي.
2. Restart once so everything loads: `/exit`, then `claude`.
   أعد التشغيل مرة واحدة: `/exit` ثم `claude`.
3. No `SessionStart:startup hook error` should appear at startup.
   يجب ألا يظهر خطأ hook عند البدء.
4. Try: *"I want a persistent memory system for my project"* / *"أريد نظام ذاكرة دائمة لمشروعي"*.

---

## 7. Claude desktop app and duplicate copies / تطبيق Claude ونسخ مكررة

The Claude desktop app has its own page: **Settings → Plugins**.
لتطبيق Claude صفحته الخاصة: **Settings → Plugins**.

- A plugin that you **upload manually** is listed as **"by you"** and is **not linked to GitHub**, so it never updates automatically.
  الإضافة التي رُفعت يدوياً تظهر **"by you"** وغير مرتبطة بـ GitHub، فلا تتحدّث تلقائياً.
- A plugin that comes from the marketplace appears under **"From marketplaces you added"**, with your name as author. This is the copy that auto-updates. Keep it.
  الإضافة القادمة من السوق تظهر تحت **"From marketplaces you added"**، وهذه هي التي تتحدّث؛ أبقِها.
- If you see **both** (for example an old uploaded `0.3.0` and the marketplace copy), remove the uploaded one: (⋮) next to it → **Remove**.
  إذا ظهرت النسختان فاحذف المرفوعة يدوياً: (⋮) بجانبها ← **Remove**.

The Claude Code terminal and the desktop app share the marketplace installation, so installing from the terminal (steps 3–5) is the most reliable way to get automatic updates.
التثبيت من الطرفية (الخطوات 3–5) هو الأوثق للحصول على التحديث التلقائي.

---

## 8. Troubleshooting / حل المشكلات

| Message or symptom / الرسالة أو العَرَض | Cause / السبب | Fix / الحل |
|---|---|---|
| `claude : The term 'claude' is not recognized` | Install folder not in `PATH` | Add it (step 3), reopen the terminal. Meanwhile run `& "$env:USERPROFILE\.local\bin\claude.exe"` |
| `iex : The term 'iex' is not recognized` | The command was pasted with a stray character at the end (e.g. `^Q`) | Retype the line without extra characters |
| `Failed to clone marketplace repository: Command 'git' not found` | Git is not installed, or the terminal was not reopened after installing it | Install Git (step 1), reopen the terminal, check `git --version` |
| `SessionStart:startup hook error ... Executable not found in $PATH: "node"` | Node.js is not installed, or the terminal was not reopened | Install Node.js (step 1), reopen the terminal, check `node --version` |
| Commands run but Claude only proposes plans; `Enabled plan mode` appeared | Plan mode is on (`/plan` or Shift+Tab) | Press **Shift+Tab** until the footer shows `auto mode on` |
| `N MCP servers need authentication · run /mcp` | Connectors from your account that need sign-in | Unrelated to this plugin; ignore, or run `/mcp` to sign in |
| Two copies of Persistent memory in the app | A manual upload plus the marketplace copy | Remove the uploaded one (step 7) |
| Plugin not updating | Auto-update is off, or the maintainer did not raise `version` | Step 5; or update manually (step 9) |
| Installer asks to run as Administrator, or you are in `C:\WINDOWS\system32` | Window opened with elevated rights | Open a normal window and run `cd ~` first |

If you hit an error that is not listed, open an issue with the exact message: https://github.com/msamkari/persistent-memory-plugin/issues
إن ظهر خطأ غير مذكور فافتح Issue مع نص الرسالة كما هو.

---

## 9. Update manually or uninstall / التحديث اليدوي والإزالة

Inside Claude Code:

```
/plugin marketplace update samkari-plugins
/reload-plugins
```

Or `/plugin` → Installed → persistent-memory → **Update now**.
أو `/plugin` ← Installed ← persistent-memory ← **Update now**.

To uninstall: `/plugin` → Installed → persistent-memory → **Uninstall**. To remove the marketplace as well: `/plugin` → Marketplaces → samkari-plugins → **Remove marketplace**. Your memory files are in your own storage and are never touched by uninstalling.
للإزالة: `/plugin` ← Installed ← **Uninstall**. ملفات الذاكرة في تخزينك الخاص ولا تتأثر بالإزالة.

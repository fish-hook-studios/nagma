# Getting started

Nagma is a free, open-source design suite: a design editor with prototyping, a whiteboard (Board),
Slides, Campaign assets, Sites, Make (apps built with AI), Video and Document (PDF). It runs on your
computer without an account, and connects to a Nagma server when you want to work with other people.

## Download

Get the desktop app from [nagma.app](https://nagma.app) or the
[latest release](https://github.com/fish-hook-studios/nagma/releases/latest):

| System | Shortcut | Release file |
|---|---|---|
| macOS (Apple silicon) | [nagma.app/download/mac](https://nagma.app/download/mac) | `Nagma-mac-arm64.dmg` |
| Windows 10 and 11 | [nagma.app/download/windows](https://nagma.app/download/windows) | `Nagma-Setup-x64.exe` |
| Linux | [nagma.app/download/linux](https://nagma.app/download/linux) | `Nagma-x86_64.AppImage` |

The desktop app bundles a small Nagma server for your own files ("This computer"), so everything
works offline. There's also the web app: any Nagma server serves it at its own address
(see [Self-hosting](self-hosting.md)).

## First run

Nagma opens on **Home**, the file browser. The first time, it shows three ways to start:

- **Use Nagma on this computer** (the default). Just closes the cards. Everything you make is a
  draft on this device. No account, no server, no limits.
- **Connect to a server**. Opens the server picker, to join your team's Nagma server or one you
  run yourself. See [Connect to a server](connect-to-a-server.md).
- **Add an AI key**. Opens **Account settings › AI**, where you add a key from Claude, OpenAI or an
  OpenAI-compatible server. See [AI keys](ai-keys.md).

You can do any of these later. To see the cards again, choose **Get started** in the Help menu (the
editor's main menu › Help and account, the desktop app's Help menu, or the account menu on Home).

The cards show once per device, not once per account or server: signing in, switching account or
connecting to another server doesn't show them again.

## Drafts

A file you create without a server is a **draft**. Drafts live on this device (in the desktop app,
in its own storage; in a browser, in that browser's storage) and appear under **Drafts** on Home.

- Drafts save as you work. Close the app and they're there next time.
- Drafts are kept apart per account and per server, so nothing from one shows up in another.
- To work on a draft with someone, choose **Share**. On a team server, Share moves the file to the
  server (owned by you) and gives you links and invitations. On This computer, Share tells you (the first time)
  that collaboration needs a server, with **Connect** (the server picker) and **Learn more**.
- Keep backups of what matters: **File › Save local copy…** downloads the file as `.nagma.json`.

## Create

The buttons at the top of Home start a **Design** file, a **Board**, **Slides** or a **Make** app;
**More** has a Document, a Video, a Campaign and a Site. New decks, campaigns and sites offer their
templates as soon as they open, and Board has them under **Templates**. Home's **Recommended
resources** has starter files to open and look around in.

## Import your existing files

Drop files onto Home, or choose **More › Import…**. Each file becomes a Nagma file of its own kind:

- design files (`.fig`, `.sketch`), slide decks (`.deck`, `.pptx`) and campaign files (`.buzz`);
- page layouts (`.idml`), each page as a frame of editable layers;
- PDFs, each page as a frame;
- layered images (`.psd`, `.psb`), other pictures, SVG, and video (`.mp4`, `.mov`, `.mkv`, `.webm`, `.mxf`).

Imports use clean-room readers written for interoperability: Nagma contains no code from the tools
that make these formats.

## Next

- [Connect to a server](connect-to-a-server.md): work with your team.
- [AI keys](ai-keys.md): where keys go, which providers, what it costs.
- [Self-hosting](self-hosting.md): run your own Nagma server in one command.

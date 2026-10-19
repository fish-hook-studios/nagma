# Connect to a server

Everything in Nagma works on your own computer. A **Nagma server** adds what needs other people:
shared files with live editing, comments, teams and projects, invitations, published sites and Make
apps.

## Three choices

| Choice | Who can open your files | What you need |
|---|---|---|
| **This computer** | Only you. Files stay on this computer. | Nothing. It's the default. |
| **Nagma (hosted)**, free | Anyone you share with, anywhere. | A free account on it, with a verified email before you share. |
| **Your own server** | Anyone you share with who can reach your server. | A server you (or your company, or a friend) run. See [Self-hosting](self-hosting.md). |

- **This computer** is the server the app came with. In the desktop app it runs on your machine
  for your own files, so a link to a file there would carry your machine's own address, which
  nobody elsewhere can open. That's why Share on This computer doesn't hand out a link.
- **Nagma (hosted)** is the server the Nagma project runs at `https://api.nagma.app`. It's free.
  Create an account in the app; it asks you to verify your email (open the link it mails you)
  before you can invite people, open a link to anyone or publish.
- **Your own server** is any Nagma server someone runs: your company's, a friend's, or one you run
  in one command ([Self-hosting](self-hosting.md)). Its address looks like
  `https://nagma.example.com`; whoever runs it can give it to you.

## Sharing a file from This computer

Choose **Share** on a file while This computer is the server. Instead of a link, Share offers:

- **Share through Nagma** (the main button). Nagma connects to the hosted server, asks you to sign
  in or create an account there, moves the file to it (owned by you), and opens Share again with a
  link like `https://api.nagma.app/?file=…` that works anywhere. The original stays on This computer.
  If your email isn't verified yet, Share shows **Verify your email** with **Resend**; once you've
  opened the link from the mail, invite people or copy the link as usual.
- **Use your own server…** opens the server picker.
- **Export a copy** downloads the file as `.nagma.json`, to send however you like.

For a file already on This computer's own server, the **…** menu in Share has **Copy local link
(same network only)**: it only opens for people on your local network while your computer is on.
Nagma never offers a link to `localhost` or a private network address any other way.

## The server picker

Open it from:

- **Get started › Connect to a server**, the first time Nagma opens (or Help › Get started);
- the **server badge** next to your name on Home, or **Server…** in the account menu on Home;
- **Nagma › Server…** in the desktop app's menu bar;
- **Change** in the sign-in dialog;
- **Use your own server…** (or **Connect**) in Share, when a file is only on this computer.

The picker lists **This computer**, **Nagma (hosted), free** (one click connects to it) and every
server you've added. To add your own:

1. Choose **Add your own server…** and type its address, such as `https://nagma.example.com`. **Where
   do I get one?** next to the field leads here. An address without a
   scheme is `https://`, except a machine on this computer or your local network
   (`localhost:8080`, `192.168.1.4:8080`), which is `http://`.
2. Choose **Check server**. Nagma shows the server's name and version, so you know it's the right one.
3. Choose **Connect to** that server, then sign in or create an account there.

To forget a server, hover it in the list and choose the cross. Switching to another server reloads
the app for that server.

## Sessions per server

Each server has its own accounts. Signing in on one doesn't sign you in on another, and switching
back to a server signs you in again as you were. You can be signed in to several accounts on the
same server and switch between them from the account menu on Home.

## Links carry their server

A link to a file on a team server says which server it's on. Opening it (in a browser, or through
the desktop app's `nagma://` links) when another server is in use offers to switch to the file's
server. Links to files on This computer don't carry a server: they only open on this machine, or
for people on your local network when the desktop app's server is reachable there.

## What stays local

- **Drafts** stay on this device, whichever server you use. What the app keeps for you (drafts,
  open tabs, recents, stars) is kept apart per server and per account, so nothing from one shows up
  on another, and nothing is lost when you switch.
- **Shared files, teams, projects and sites** belong to the server they're on. Tabs for another
  server's files close when you switch away and come back when you switch back.
- **Device preferences** (theme, interface scale, panel layout, which hints you've seen) are the
  same for every server and account on this device.
- To share a draft, open it and choose **Share**: on the hosted server or a team server it moves to
  the server, owned by you, and you can invite people or copy a link. On This computer, Share
  offers **Share through Nagma** (above).

## Running your own

On a Linux server with a domain pointing at it:

```bash
curl -fsSL https://raw.githubusercontent.com/fish-hook-studios/nagma/main/tools/install.sh | sudo bash
```

The installer sets up Docker, asks for your domain and admin email, and starts Nagma with automatic
HTTPS. Then add the address in the picker. [Self-hosting](self-hosting.md) has the details, the
docker compose alternative, DNS, backups and upgrades.

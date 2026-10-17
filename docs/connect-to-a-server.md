# Connect to a server

Everything in Nagma works on your own computer. A **Nagma server** adds what needs other people:
shared files with live editing, comments, teams and projects, invitations, published sites and Make
apps. Your company may run one, a friend may, or you can run your own in one command
([Self-hosting](self-hosting.md)).

## The server picker

Open it from:

- **Get started › Connect to a server**, the first time Nagma opens (or Help › Get started);
- the **server badge** next to your name on Home, or **Server…** in the account menu on Home;
- **Nagma › Server…** in the desktop app's menu bar;
- **Change** in the sign-in dialog;
- **Connect** in Share, when a file is only on this computer.

The picker lists **This computer** (the server the app came with: in the desktop app, the one it
runs for your own files) and every server you've added. To add one:

1. Choose **Add server…** and type its address, such as `nagma.example.com`. An address without a
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
- To share a draft, open it and choose **Share**: on a team server it moves to the server, owned by
  you, and you can invite people or copy a link.

## Running your own

On a Linux server with a domain pointing at it:

```bash
curl -fsSL https://raw.githubusercontent.com/fish-hook-studios/nagma/main/tools/install.sh | sudo bash
```

The installer sets up Docker, asks for your domain and admin email, and starts Nagma with automatic
HTTPS. Then add the address in the picker. [Self-hosting](self-hosting.md) has the details, the
docker compose alternative, DNS, backups and upgrades.

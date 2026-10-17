# AI keys

Nagma's AI features run on a key you bring: from Claude, from OpenAI, or from any server that speaks
the OpenAI API (such as a model running on your own machine). Nagma doesn't sell AI and doesn't
take a cut. You pay your provider directly for what you use, or nothing at all with a local model.

What uses AI: the Agents panel in the design editor, Make (apps from prompts), Board's AI actions
(sorting and summarising stickies), slide drafts, campaign bulk fill, and image generation and
**Edit with prompt** on pictures (with an image model). Everything else in Nagma works without a key.

## Where keys go

**Account settings › AI.** Open it from:

- **Get started › Add an AI key**, the first time Nagma opens (or Help › Get started);
- Help › **AI settings…** in the editor's menu;
- **Open AI settings** on the notice any AI feature shows when there's no key to use.

Where the key is kept depends on how you use Nagma:

| You are | The key is kept |
|---|---|
| Signed in on a server | With your account on that server, encrypted. It's never shown again after you save it. |
| In the desktop app, signed out | By Nagma on this computer, encrypted, for this device. |
| In a browser, signed out | In this browser only. It goes with each AI request through the server, which doesn't keep it. Anyone using this browser can use it. |

Keys are encrypted at rest (AES-256-GCM) on the server, never sent back to the app after you save
them, and never logged.

## Providers

| Provider | Key | Notes |
|---|---|---|
| Claude | `sk-ant-…` from your Anthropic console | Make can search the web, use connectors and show its thinking. |
| OpenAI | `sk-…` from your OpenAI account | |
| OpenAI-compatible | The server's key, if it needs one | A local or self-hosted model. In a browser the address must be public `https`; the desktop app can reach models on your machine, such as `http://localhost:11434/v1`. |

After saving, pick a **Model** from the ones your key can use, and choose **Test** to check it.

**Image generation** is separate: OpenAI images (it can reuse your OpenAI key) or a compatible
endpoint. Without an image model, campaign pictures can still be drawn from the brand kit's colours.

## Costs

Nagma itself is free. AI requests are billed by your provider at their prices, to your account with
them. The **Usage** line in the AI tab shows today's requests and a rough token count, so you can
estimate what you're spending. A local model costs nothing beyond your own hardware.

Each person can make 30 AI requests a minute on a server (the admin can change this).

## The shared key (for server admins)

A server can offer a key for everyone signed in who hasn't added their own. Set it in the server's
`.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...      # the shared key (Claude)
ANTHROPIC_MODEL=                  # optional: the model it uses
NAGMA_IMAGE_API_URL=              # optional: a shared image model (OpenAI-style endpoint)
NAGMA_IMAGE_API_KEY=
NAGMA_SHARED_AI=0                 # turns the shared key and image model off
NAGMA_AI_PER_MINUTE=30            # requests a minute, per person
```

Who pays for a request, in order: the person's own key, then the shared key (signed-in people only).
With neither, the feature says where to add a key. People who aren't signed in never use the shared
key.

**Usage.** The admin console's **AI credits** page shows the shared key's use over the last 14 days
and today's use by person. Team AI credits are counted only when the shared key answered: someone
using their own key costs the team nothing.

See [Self-hosting](self-hosting.md) for the rest of the server's settings.

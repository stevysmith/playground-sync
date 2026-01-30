---
name: playground
description: Creates interactive HTML playgrounds — self-contained single-file explorers that let users configure something visually through controls, see a live preview, and copy out a prompt. Use when the user asks to make a playground, explorer, or interactive tool for a topic.
---

# Playground Builder

A playground is a self-contained HTML file with interactive controls on one side, a live preview on the other, and a prompt output at the bottom with a copy button. The user adjusts controls, explores visually, then copies the generated prompt back into Claude.

## When to use this skill

When the user asks for an interactive playground, explorer, or visual tool for a topic — especially when the input space is large, visual, or structural and hard to express as plain text.

## How to use this skill

1. **Identify the playground type** from the user's request
2. **Explore the project's design system.** Before building, search for existing styles, components, design tokens, CSS variables, Tailwind config, theme files, or UI libraries in the project. Incorporate the project's actual colors, typography, spacing, border-radius, shadows, and component patterns into the playground so the preview reflects what things will really look like in the codebase.
3. **Load the matching template** from `templates/`:
   - `templates/design-playground.md` — Visual design decisions (components, layouts, spacing, color, typography)
   - `templates/data-explorer.md` — Data and query building (SQL, APIs, pipelines, regex)
   - `templates/concept-map.md` — Learning and exploration (concept maps, knowledge gaps, scope mapping)
   - `templates/document-critique.md` — Document review (suggestions with approve/reject/comment workflow)
   - `templates/diff-review.md` — Code review (git diffs, commits, PRs with line-by-line commenting)
   - `templates/code-map.md` — Codebase architecture (component relationships, data flow, layer diagrams)
4. **Follow the template** to build the playground. If the topic doesn't fit any template cleanly, use the one closest and adapt.
5. **Open in browser.** After writing the HTML file, run `open <filename>.html` to launch it in the user's default browser.
6. **Watch for prompts in a loop.** After opening the playground, call the `playground_watch` MCP tool to wait for the user to click "Send to Claude". Tell the user you're watching for their prompt. When a prompt arrives, act on it, call `playground_clear`, and then call `playground_watch` again to wait for the next prompt. Repeat this loop indefinitely — every completed request should end with another `playground_watch` call so the user can keep sending prompts without restarting.

## Core requirements (every playground)

- **Single HTML file.** Inline all CSS and JS. No external dependencies.
- **Live preview.** Updates instantly on every control change. No "Apply" button.
- **Prompt output.** Natural language, not a value dump. Only mentions non-default choices. Includes enough context to act on without seeing the playground. Updates live.
- **Copy button.** Clipboard copy with brief "Copied!" feedback.
- **Send to Claude button.** Next to the copy button, include a "Send to Claude" button that posts the prompt to `localhost:4242`. Falls back gracefully if no server is running. Include the transport snippet (see below).
- **Sensible defaults + presets.** Looks good on first load. Include 3-5 named presets that snap all controls to a cohesive combination.
- **Dark theme.** System font for UI, monospace for code/values. Minimal chrome.

## State management pattern

Keep a single state object. Every control writes to it, every render reads from it.

```javascript
const state = { /* all configurable values */ };

function updateAll() {
  renderPreview(); // update the visual
  updatePrompt();  // rebuild the prompt text
}
// Every control calls updateAll() on change
```

## Prompt output pattern

```javascript
function updatePrompt() {
  const parts = [];

  // Only mention non-default values
  if (state.borderRadius !== DEFAULTS.borderRadius) {
    parts.push(`border-radius of ${state.borderRadius}px`);
  }

  // Use qualitative language alongside numbers
  if (state.shadowBlur > 16) parts.push('a pronounced shadow');
  else if (state.shadowBlur > 0) parts.push('a subtle shadow');

  prompt.textContent = `Update the card to use ${parts.join(', ')}.`;
}
```

## Claude Sync transport snippet

Every playground must include this snippet alongside the copy button. It enables the "Send to Claude" button which posts the prompt to a local sync server. If the server isn't running, the button shows "No server" briefly and the user can still copy-paste.

```html
<button id="send-btn" onclick="sendToClaude()">Send to Claude</button>
```

```javascript
const SYNC_URL = 'http://localhost:4242';

async function sendToClaude() {
  const prompt = document.getElementById('prompt-output').textContent;
  const btn = document.getElementById('send-btn');
  btn.textContent = 'Sending...';
  try {
    await fetch(SYNC_URL + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, url: location.href, pathname: location.pathname })
    });
    btn.textContent = 'Sent ✓';
    setTimeout(() => btn.textContent = 'Send to Claude', 2000);
  } catch {
    btn.textContent = 'No server';
    setTimeout(() => btn.textContent = 'Send to Claude', 3000);
  }
}

try {
  const es = new EventSource(SYNC_URL + '/events');
  es.addEventListener('status', e => {
    const d = JSON.parse(e.data);
    const btn = document.getElementById('send-btn');
    if (d.status === 'processing') btn.textContent = 'Claude working...';
    if (d.status === 'done') { btn.textContent = 'Done ✓'; setTimeout(() => btn.textContent = 'Send to Claude', 2000); }
  });
} catch {}
```

## Common mistakes to avoid

- Prompt output is just a value dump → write it as a natural instruction
- Too many controls at once → group by concern, hide advanced in a collapsible section
- Preview doesn't update instantly → every control change must trigger immediate re-render
- No defaults or presets → starts empty or broken on load
- External dependencies → if CDN is down, playground is dead
- Prompt lacks context → include enough that it's actionable without the playground

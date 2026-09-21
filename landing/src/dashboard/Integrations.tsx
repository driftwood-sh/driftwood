import { useState } from "react";

const commands = [
  { label: "Install the CLI", command: "uv tool install --python 3.12 driftwood-cli" },
  { label: "Sign in to your workspace", command: "driftwood login" },
  { label: "Continue company setup", command: "driftwood onboard resume" },
  { label: "Check your connections", command: "driftwood doctor" },
];

export default function Integrations() {
  const [message, setMessage] = useState("");

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage(`Copied: ${command}`);
    } catch {
      setMessage("Copy is unavailable. Select the command and copy it manually.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Your <em className="voice text-tide [font-family:Georgia,serif]">integrations</em></h1>
        <p className="mt-3 text-gray">Connect your AI assistant or terminal to this Driftwood workspace.</p>
      </header>

      <section aria-labelledby="mcp-heading" className="rounded-xl border border-line bg-white p-6 sm:p-8">
        <h2 id="mcp-heading" className="text-xl font-semibold">Connect your <em className="voice text-tide [font-family:Georgia,serif]">AI assistant</em></h2>
        <p className="mt-3 text-gray">Connect Codex or another assistant that supports remote MCP servers to review demos, prepare outreach, and check your sending queue.</p>
        <ol className="my-5 list-decimal space-y-2 pl-5 text-sm text-gray">
          <li>Open connection settings and create a personal access token.</li>
          <li>Copy the server configuration into your assistant’s MCP settings.</li>
          <li>Ask it to show completed demos. Approve the demos you want recipients and emails prepared for.</li>
          <li>Review the recipient addresses and complete emails, then explicitly approve the emails you want queued.</li>
        </ol>
        <a href="/api/v1/dashboard/mcp/connect" className="inline-flex rounded-full bg-tide px-5 py-2.5 text-sm font-medium text-white hover:bg-tide-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-tide">Manage MCP connections</a>
        <p className="mt-4 text-sm text-gray">Demo approval prepares outreach. Email approval is a separate decision by an authorized person and follows your workspace review settings. Queued emails follow your sending schedule and limits. You can revoke access in connection settings.</p>
        <blockquote className="mt-4 rounded-lg bg-tide-wash p-4 text-sm text-ink">“Show my demos and their approval status. For approved demos, show every recipient, subject, and complete email with the preview link. Wait for my approval of those emails before queuing them.”</blockquote>
      </section>

      <section aria-labelledby="cli-heading" className="rounded-xl border border-line bg-white p-6 sm:p-8">
        <h2 id="cli-heading" className="text-xl font-semibold">Set up from your <em className="voice text-tide [font-family:Georgia,serif]">terminal</em></h2>
        <p className="mt-3 text-gray">The Driftwood CLI guides company setup, account connections, team invitations, assets, and send schedules. You can resume setup where you left off.</p>
        <p className="mt-4 rounded-lg bg-tide-wash p-4 text-sm text-ink">Start by <a href="https://docs.astral.sh/uv/getting-started/installation/" className="text-tide underline underline-offset-2">installing uv</a>, then run the commands below. The CLI uses Python 3.12 and your operating system’s credential store. <a href="https://pypi.org/project/driftwood-cli/" className="text-tide underline underline-offset-2">View the package on PyPI.</a></p>
        <div className="mt-5 space-y-4">
          {commands.map(({ label, command }) => (
            <div key={command}>
              <p className="mb-2 text-sm text-gray">{label}</p>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                <code className="break-all text-sm">{command}</code>
                <button type="button" onClick={() => void copy(command)} aria-label={`Copy ${command}`} className="rounded-full border border-line px-4 py-1.5 text-sm text-tide hover:bg-tide-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">Copy</button>
              </div>
            </div>
          ))}
        </div>
        <p role="status" className="mt-3 min-h-5 text-sm text-gray">{message}</p>
        <p className="mt-2 text-sm text-gray">Login and account consent open in your browser. Workspace approval is still required, and completing setup does not start outreach.</p>
      </section>
    </div>
  );
}

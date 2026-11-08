// Notifications push via ntfy (https://ntfy.sh) — appli gratuite iOS / Android.
// Variables : NTFY_TOPIC (obligatoire pour activer), NTFY_SERVER (défaut https://ntfy.sh), NTFY_TOKEN (optionnel).

export function dashboardUrl() {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL.replace(/\/$/, "");
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!repo) return "";
  const [owner, name] = repo.split("/");
  return `https://${owner.toLowerCase()}.github.io/${name}`;
}

export async function notify({ title, message, click, actions = [], tags = [], priority = 3 }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.log(`[notify] (NTFY_TOPIC absent, notification ignorée) ${title}`);
    return false;
  }
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const headers = { "content-type": "application/json" };
  if (process.env.NTFY_TOKEN) headers.authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  const res = await fetch(server, {
    method: "POST",
    headers,
    body: JSON.stringify({ topic, title, message, click, actions, tags, priority }),
  });
  if (!res.ok) console.warn(`[notify] échec ${res.status}: ${await res.text()}`);
  return res.ok;
}

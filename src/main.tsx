import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { RELEASE } from "./release-info.ts";

function formatLocal(date: Date): string {
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

const notReleased = (RELEASE.releasedAtLocal as string) === "not-released-yet";

const releaseDate = notReleased ? new Date() : new Date(RELEASE.releasedAt);
const releaseLine = notReleased
  ? `[${RELEASE.name}] v${RELEASE.version}-dev · ${formatLocal(releaseDate)} (local, not released yet)`
  : `[${RELEASE.name}] v${RELEASE.version} · last release ${formatLocal(releaseDate)}`;

console.info("%c" + releaseLine, "color:#0e7490;font-weight:600");

createRoot(document.getElementById("root")!).render(<App />);

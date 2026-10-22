// Picks the right collector for a repository link.
// v1 checks GitHub only. The Forgejo/Codeberg collector (forges/forgejo.js) is kept for a later release.
import { parseRepoUrl } from "./util.js";
import { collectGitHub } from "./forges/github.js";

export const SUPPORTED = { github: "GitHub" };

export async function collect(input, opts = {}) {
  const ref = typeof input === "string" ? parseRepoUrl(input) : input;
  if (!ref) throw new Error("That doesn't look like a link to a repository. Try something like github.com/owner/project.");
  if (ref.forge === "github") return collectGitHub(ref, opts);
  throw new Error(`For now, OSS Fidelity checks GitHub projects only. Support for ${ref.host} is planned.`);
}

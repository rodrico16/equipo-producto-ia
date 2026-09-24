import assert from "node:assert/strict";
import { findReusablePullRequest } from "../lib/existing-pull-request.ts";

const openPr = {
  number: 40,
  state: "open",
  draft: true,
  html_url: "https://github.com/owner/repo/pull/40",
  head: { ref: "ai/control-room-1", repo: { full_name: "owner/repo" } },
  base: { ref: "main", repo: { full_name: "owner/repo" } },
};
const mock = (status, data) => async () => new Response(JSON.stringify(data), { status });
assert.deepEqual(await findReusablePullRequest("owner/repo", 40, "token", mock(200, openPr)), {
  number: 40, url: openPr.html_url, branch: openPr.head.ref, baseBranch: "main",
});
assert.equal(await findReusablePullRequest("owner/repo", 40, "token", mock(200, { ...openPr, state: "closed" })), null);
assert.equal(await findReusablePullRequest("owner/repo", 40, "token", mock(200, { ...openPr, head: { ...openPr.head, repo: { full_name: "someone/fork" } } })), null);
assert.equal(await findReusablePullRequest("owner/repo", 40, "token", mock(404, {})), null);
assert.equal(await findReusablePullRequest("owner/repo", undefined, "token", () => { throw Error("unexpected request"); }), null);
await assert.rejects(() => findReusablePullRequest("owner/repo", 40, "token", mock(403, {})), { name: "GitHubPublicationAuthError", reason: "permission" });
await assert.rejects(() => findReusablePullRequest("owner/repo", 40, "token", mock(500, {})), /Could not verify existing Pull Request/);
console.log("Existing PR reuse: OK");

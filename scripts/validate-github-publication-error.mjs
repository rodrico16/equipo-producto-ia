import assert from "node:assert/strict";
import { apiAuthFailure, pushAuthFailure, GitHubPublicationAuthError } from "../lib/github-publication-error.ts";

assert.equal(pushAuthFailure("remote: Permission to owner/repo denied to user. The requested URL returned error: 403"), "permission");
assert.equal(pushAuthFailure("remote: Write access to repository not granted."), "permission");
assert.equal(pushAuthFailure("fatal: Authentication failed for https://github.com/owner/repo"), "expired");
assert.equal(pushAuthFailure("fatal: failed to connect to github.com"), null);
assert.equal(apiAuthFailure(401, "Bad credentials"), "expired");
assert.equal(apiAuthFailure(403, "Resource not accessible by integration"), "permission");
assert.equal(apiAuthFailure(422, "Validation Failed"), null);
assert.equal(apiAuthFailure(500, "Server error"), null);
const failure = new GitHubPublicationAuthError("pull_request", "permission");
assert.equal(failure.stage, "pull_request");
assert.match(failure.message, /Reconectá GitHub/);
console.log("GitHub publication errors: OK");

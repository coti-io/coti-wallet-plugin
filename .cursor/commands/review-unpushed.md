# Review unpushed commits (Bugbot-style)

Review **local commits that are not on the remote yet**, using the same bug-hunting mindset as GitHub Bugbot — without calling the Bugbot subagent or requiring Bugbot billing.

## Scope

1. Resolve the git repo to review:
   - Prefer the repo containing the user's focused/open file.
   - Else the workspace root if it is a git repo.
   - If multiple repos are open and ambiguous, ask which path to use.

2. Compute the unpushed diff (run these in that repo):

```bash
# Upstream if configured
git rev-parse --abbrev-ref @{upstream} 2>/dev/null

# Commits not on remote
git log --oneline @{upstream}..HEAD

# Patch for those commits (merge-base style)
git diff @{upstream}...HEAD
```

If there is **no upstream**:

```bash
# Prefer origin/main, then origin/master, then main
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD origin/master 2>/dev/null || git merge-base HEAD main
git log --oneline <merge-base>..HEAD
git diff <merge-base>...HEAD
```

Also include **uncommitted** staged/unstaged changes in the same review (`git status` + `git diff` + `git diff --cached`), labeled separately from unpushed commits.

If there is nothing to review (no unpushed commits and clean tree), say so in one sentence and stop.

## Review rules (Bugbot-like)

Focus on **real bugs and regressions**, not style or preference nits.

Prioritize:
- Incorrect control flow / wrong method chosen (e.g. `approve` vs `increaseAllowance`)
- Fail-open vs fail-closed around security-sensitive paths
- Thrown errors after a successful on-chain/tx receipt
- Broken parsing of external shapes (ethers `Result`, ABI tuples, RPC responses)
- Null/zero coercion that changes behavior
- Race conditions, stale state, missing await
- Tests that assert the wrong behavior or miss the failure mode

Ignore unless clearly harmful:
- Naming, formatting, comment wording
- Optional refactors
- Test coverage “nice to haves” that do not lock a bug

Do **not** use the Bugbot/`bugbot` subagent. Do the review yourself from the diff.

Do **not** fix findings unless the user explicitly asks.

## Output format

1. One-line status: `Unpushed review: N findings` (or `no bugs`).
2. If findings exist, a markdown table sorted by severity (highest first):

| Severity | Location (file:line) | Finding |
|----------|----------------------|---------|
| High | path/to/file.ts:123 | Short description |

Severity labels: `Critical`, `High`, `Medium`, `Low`.

3. Under the table, optional short notes (max 3 bullets) only if needed for context.
4. End with: “Say the word if you want these fixed.”

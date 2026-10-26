# Feedback census

Mined 2026-10-26 from the review threads, issue comments, and check runs on
[PR #64](https://github.com/amanthanvi/scrutinix/pull/64) (verify setup) and
Dependabot PRs [#65](https://github.com/amanthanvi/scrutinix/pull/65),
[#66](https://github.com/amanthanvi/scrutinix/pull/66),
[#67](https://github.com/amanthanvi/scrutinix/pull/67),
[#68](https://github.com/amanthanvi/scrutinix/pull/68), and
[#69](https://github.com/amanthanvi/scrutinix/pull/69), plus CI on the squash
commits those merges added to `main`. This file covers that set only.

Reviewers in these threads were Greptile, CodeRabbit, Sourcery, and the
human author. Copilot left one quota notice on #64 and no review.
Dependabot PRs had no inline review threads. The line comments are all on
#64 (eight Greptile threads, all resolved).

Counts below are occurrences inside this set. A count of 1 is still a
pitfall when the same edit would recreate it.

## Proof before merge

Feature PRs need the Proof section in
`.agents/skills/verify-scrutinix/SKILL.md`: exact commands, evidence paths
that survive cleanup, a result per command, and `INCONCLUSIVE` where a step
could not run. Dependency PRs need a narrower proof: the full PR head SHA,
and the Audit and Verify job URLs for that SHA. Either way the proof has to
be on the PR before the merge, and it has to name the head that merged.

| PR                                                     | Merged | Full head SHA in the proof | Verify job             |
| ------------------------------------------------------ | ------ | -------------------------- | ---------------------- |
| [#64](https://github.com/amanthanvi/scrutinix/pull/64) | yes    | no                         | no                     |
| [#65](https://github.com/amanthanvi/scrutinix/pull/65) | yes    | no                         | no                     |
| [#66](https://github.com/amanthanvi/scrutinix/pull/66) | yes    | no                         | no                     |
| [#67](https://github.com/amanthanvi/scrutinix/pull/67) | yes    | yes, after `mergedAt`      | yes, after `mergedAt`  |
| [#68](https://github.com/amanthanvi/scrutinix/pull/68) | no     | no                         | no                     |
| [#69](https://github.com/amanthanvi/scrutinix/pull/69) | yes    | yes, before `mergedAt`     | yes, before `mergedAt` |

Four merges landed without a proof that covered the head (#64, #65, #66,
#67). #68 closed unmerged, also with no proof. #69 is the Dependabot proof
that met the bar.

- **#64.** The body has local `verify:check`, smoke, and drive results, and
  no evidence-directory paths. The only SHA comment names
  `1a23cf0fd22a14f99a56002e055ce259dc79a0de`
  ([comment](https://github.com/amanthanvi/scrutinix/pull/64#issuecomment-6193048517),
  2026-10-15). The merged head is
  `0b52fb887754fc29fd59c4ffbbdf6c554e77de64`. Landing notes say "verified on
  the rebased branch" and name no commit.
- **#65.** No proof comment. Merged 2026-10-13. Head
  `3ee6e41e26b2515718c693a1e9ab8b7df458b3dc` had green Audit and Verify.
- **#66.** No proof comment. Merged 2026-10-13, about three minutes after a
  rate-limited CodeRabbit reply. Head
  `f14c0048019da6cb717da415a71ce858160a9d65`.
- **#67.** [Comment](https://github.com/amanthanvi/scrutinix/pull/67#issuecomment-6173656596)
  names head `dc59defb30760c97094914b35b9f828488bf8111` and the
  [Verify job](https://github.com/amanthanvi/scrutinix/actions/runs/38601392020/job/115981259006).
  Posted 2026-10-14T16:55:19Z. `mergedAt` is 2026-10-14T16:55:00Z, so the
  proof arrived 19 seconds after the merge.
- **#68.** No proof. The
  [close note](https://github.com/amanthanvi/scrutinix/pull/68#issuecomment-6273197719)
  says #69 already shipped vitest 5.0.5. Closed, not merged. Head
  `fb0ec10767a1e432a802bfadc1b5dcc7df39f06f` was green.
- **#69.** [Comment](https://github.com/amanthanvi/scrutinix/pull/69#issuecomment-6273113930)
  names `2ae80fd94259e2f9ff40cbdf981750b1f309e5c7` and links the
  [Verify job](https://github.com/amanthanvi/scrutinix/actions/runs/39268074685/job/118112798580).
  Posted 2026-10-19T17:25:35Z, six seconds before `mergedAt` 17:25:41Z.

**Rule.** Write the proof against `gh pr view --json headRefOid` and post it
before merging. Quote the full 40-character head SHA. Link the Audit job and
the Verify job whose `headSha` is that same commit. A proof that names an
earlier SHA, a proof with no SHA, and a proof posted after `mergedAt` do not
cover the merge. When a later commit is added, replace the proof; do not
leave the old SHA in place. #64 had to take commits off the branch so
`1a23cf0` would stay the proved commit, then the branch moved again before
merge and the new head was never named.

Squash commits on `main` are different SHAs from the PR heads. Push CI on
each of these succeeded (Audit and Verify both success):

- #64 `fb9b8bb6f9e2525388b0c564b14c317c0b436252`, [run](https://github.com/amanthanvi/scrutinix/actions/runs/40152396423)
- #65 `999edcdcb0f823b61c820a3bf7fd2d96a1d66cdb`, [run](https://github.com/amanthanvi/scrutinix/actions/runs/38440209625)
- #66 `71bb00e325a8bc9552c1b1a9a4ac3837efa07c7a`, [run](https://github.com/amanthanvi/scrutinix/actions/runs/38430104295)
- #67 `e0cad01d9cec2b2fe239eff272249a5ae73d82fc`, [run](https://github.com/amanthanvi/scrutinix/actions/runs/38602150263)
- #69 `7f0184ee020a4dbe0bf99593a3aefe5f917a7a6e`, [run](https://github.com/amanthanvi/scrutinix/actions/runs/39294028285)

**Rule.** After a squash, confirm the push run on the new `main` SHA. The
PR-head proof does not mention that SHA.

## A green bot check is not a review

Seen on every Dependabot PR in this set, and on the final head of #64 for
Sourcery.

CodeRabbit's check went success when the review did not cover the head:

- Bot author, review skipped until someone comments `@coderabbitai review`:
  [#68](https://github.com/amanthanvi/scrutinix/pull/68#issuecomment-6269422155),
  [#69](https://github.com/amanthanvi/scrutinix/pull/69#issuecomment-6269468617).
  Both later received that comment. Neither has a CodeRabbit review
  submission or a "review finished" reply. The check stayed success.
- Rate limit, review not run:
  [#65](https://github.com/amanthanvi/scrutinix/pull/65#issuecomment-6150077851)
  (retried an hour later and then finished),
  [#66](https://github.com/amanthanvi/scrutinix/pull/66#issuecomment-6150081431)
  (never retried; merged anyway).
- "No files to review" on the updated head:
  [#67](https://github.com/amanthanvi/scrutinix/pull/67#issuecomment-6173559895),
  after a merge from `main`. The earlier CodeRabbit pass covered
  `e89276f14e21df87a28a5a94a17ff9167b21b482`, and `package-lock.json` is
  excluded by CodeRabbit's path filter. Greptile did review the new head
  `dc59def`.
- Included allowance is one review per hour. #67's request at 16:20:04
  consumed it, so #65 and #66, requested in the same minute, were refused.

CodeRabbit on #65 also listed Audit, Verify, and Greptile under "checks
skipped due to timeout" and still posted no actionable comments. Those jobs
had not finished. They later succeeded.

Greptile on #69 scored 5/5 and wrote "Builds and tests were not run"
([comment](https://github.com/amanthanvi/scrutinix/pull/69#issuecomment-6272238535)).
The proof still had to link the Verify job, and it did.

Sourcery skipped on the final #64 head and on #67 (review budget). #64's
[budget comment](https://github.com/amanthanvi/scrutinix/pull/64#issuecomment-6191317821)
says the diff-character cap was spent. #67's proof correctly calls that skip
a budget miss, not a failure. A skip is also not an approval.

**Rule.** Merge on Audit and Verify for the head SHA, plus a review reply
that names that SHA. Treat CodeRabbit success as decorative when the comment
says skipped, rate limited, or no files to review. Request
`@coderabbitai review` and `@greptileai review` once per new head, after the
commit is pushed, and wait for the reply. Space CodeRabbit requests at least
an hour apart while the included allowance is one review per hour. #64 sent
seven `@greptileai review` comments, several inside the same half hour.

## Check results that were red, and what they meant

Final heads of all six PRs were green on Audit and Verify. #64 was red four
times on the way there. Dependabot CI never went red.

| Run                                                                             | Head         | Job                |
| ------------------------------------------------------------------------------- | ------------ | ------------------ |
| [38735480301](https://github.com/amanthanvi/scrutinix/actions/runs/38735480301) | `f6a5496cb6` | Verify, Format     |
| [38736005333](https://github.com/amanthanvi/scrutinix/actions/runs/38736005333) | `206458c655` | Verify, Install    |
| [38740769671](https://github.com/amanthanvi/scrutinix/actions/runs/38740769671) | `6d1f38dff5` | Verify, Lighthouse |
| [39796798300](https://github.com/amanthanvi/scrutinix/actions/runs/39796798300) | `a34fe53680` | Audit              |

- **38735480301.** `prettier --check` failed on
  `.agents/skills/verify-scrutinix/scripts/runtime.mjs`,
  `scripts/runtime.check.mjs`, and `SKILL.md`.
- **38736005333.** `npm ci` reached the registry with `ETIMEDOUT`. The same
  run warned that `playwright-report/` was missing.
- **38740769671.** Lighthouse printed `performance: 0.88` against a 0.90
  minimum. Accessibility was 1.00.
- **39796798300.** Audit reported 5 unreviewed vite advisories and 0
  fixable: [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv),
  [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw),
  [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm),
  [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22),
  and [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg).
  `braces` GHSA-vfj7-8cjw-p6xm was already accepted.

**Rules.**

- Run `npm run format:check` on verify-skill edits before pushing. Prettier
  checks `SKILL.md` as well as the scripts. Seen once, and it failed the
  Verify job.
- An `npm ci` timeout is a registry failure. Rerun the job. The
  `playwright-report/` warning on that same failure means the upload step
  (`if: failure()`) ran before Playwright produced a report. Seen once, on
  the install failure above. The format failure produced the same warning.
- A single Lighthouse performance sample under 0.90, with accessibility at
  1.00, matches the documented runner swing. The gate is the median of the
  configured runs. Seen once. Do not change the page off one sample.
- A red Audit that lists unreviewed GHSA ids blocks the merge. Record a
  review or rebase onto the `main` that already bumped the package. Seen
  once, on a verify-skill commit whose lockfile was still the vulnerable
  vite. `npm audit fix --force` is not the fix. The final #64 head passed
  Audit.

The weekly schedule runs Audit and skips Verify (`github.event_name !=
'schedule'` in `.github/workflows/ci.yml`). The squash SHA of #67 later
picked up [scheduled run 39212485982](https://github.com/amanthanvi/scrutinix/actions/runs/39212485982),
whose Verify job is skipped, beside the successful push run linked above.

**Rule.** Cite the `pull_request` or `push` Verify job for that SHA. A later
scheduled skip means the suite was not asked to run again.

## Verify-skill review findings (#64)

Eight Greptile threads, one PR, several of them on the second or third
round. Each one below was fixed or deliberately replaced by the supervisor
design that landed. Repeating the old shape brings the finding back.

1. **Private state directory.** `ensureDirs` accepted an existing
   `/tmp/scrutinix-verify` and then wrote scripts `bash` would run.
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4282604619).
   **Rule.** Create the state directory `0700`, and reject a symlink, a
   different owner, or group/world access before writing anything executable.
2. **One checkout owns the run.** A shared `run.json` and a fixed session
   name made checkout B reuse A's server and let B stop it.
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4282604633).
   **Rule.** Persist the resolved checkout path and refuse to reuse or stop
   a run recorded for a different path.
3. **`ss` pid format.** `listenerPids` accepted `pid 123` and missed
   `pid=123`, so cleanup recorded no listener where `ss` was installed.
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4282604646).
   **Rule.** Parse both forms, or read the pid from `/proc`.
4. **Evidence stays local.** Greptile asked the smoke workflow to upload
   `/tmp/scrutinix-verify/evidence` with `if: always()`.
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4282604656).
   An upload was added, then removed. The merged workflow uploads nothing,
   and the PR body says Playwright reports and traces stay in a private
   folder because they hold raw output.
   **Rule.** Keep traces, HTML reports, and subprocess logs off the
   workflow artifacts and out of the PR. Upload suggestions for that
   directory undo the landed safety model.
5. **`next-env.d.ts` snapshot.** A restart overwrote the saved snapshot with
   Next's rewrite, so cleanup restored the wrong bytes.
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4283043403).
   The follow-up kept an unfinished snapshot and could restore it over a
   newer edit.
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4283156419).
   **Rule.** Keep the original snapshot until cleanup consumes it. On the
   next launch, keep it only when the current file still matches the
   snapshot or the recorded write. Drop an unfinished snapshot when no run
   was recorded.
6. **`awk` without `strtonum`.** The manual listener fallback in `SKILL.md`
   failed under `mawk` (`function strtonum never defined`).
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4283287544).
   **Rule.** Compare the hex port, or require `gawk`. Do not call
   `strtonum`.
7. **Path identity and PID reuse.** `command.includes(repoRoot)` treats
   `/work/app-worker` as `/work/app`, so a reused pid could be signalled.
   [Thread](https://github.com/amanthanvi/scrutinix/pull/64#discussion_r4349710012).
   The same substring bug (`/tmp/scrutinix` matching `/tmp/scrutinix-clean`)
   was held as C2 in the [follow-up comment](https://github.com/amanthanvi/scrutinix/pull/64#issuecomment-6193048517).
   The landed cleanup does not signal a pid. It asks that run's supervisor
   to stop its own process group.
   **Rule.** Match paths on a boundary. Do not signal a recorded pid. A
   substring check is not an identity check.

Held on purpose in that same comment, and not part of the merged tree:
back up the old snapshot on launch's drop path (C1), distinguish a
`missing: true` backup from an empty snapshot (C3), and skip the cleanup
warning when the only `next-env` record belongs to another checkout (C4).
A written-once `written` record drafted in `bb53e0d` was held with them.

**Rule.** Those four items are deferred follow-ups with a named proof
commit. Shipping them means a new PR whose proof names the new head, not
another commit on a branch whose proof SHA was frozen.

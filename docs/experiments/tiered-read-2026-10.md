# Experiment: tiered read vs full read (2026-10)

Question: instead of reading a whole decision log at session start, would "compressed history + index + on-demand fetch" cut cost without hurting answer quality?

Decision: keep the full read. Show the cost (v1.1.0) and let the user decide when to compress.

## Setup
- Input: one real decision log, 78 KB (about 35k tokens), already partly compressed: older entries are 1-2 line summaries, the 10 newest entries are full text.
- Four ways of reading it, each in a fresh Claude session (Sonnet 5.5) with no other tools than listed:
  - A: the whole file in context (current behavior). No tools.
  - B: compressed part + index of recent entries + the 2 newest entries in full. Read tool for the rest.
  - C: compressed part + index only. Read tool.
  - D: like C, plus Grep over the full file, and an instruction to search before ever answering "not recorded".
- 14 questions with reference answers taken from the file: 6 about the newest entries, 5 about recent entries outside B's full text, 2 about old compressed entries, 1 whose answer is not in the log. Each question ran in its own session. Cost and tokens are Claude Code's own usage figures at list price, cold cache.
- Grading: regular expressions on required facts, then a read-through of the answers by the assistant that ran the test (provenance, such as "stated by the owner" vs "inferred", was checked too). A separate agent session then audited the numbers and the answers against the raw runs; its corrections are applied below. No human graded the answers.

## Results (means per question)

Start tokens are the size of the first-turn prompt, taken from single-turn sessions. Cost is per question in its own cold-cache session.

| | start tokens | cost | time | correct |
|---|---|---|---|---|
| A full read | 34.9k | $0.144 | 8.8 s | 14/14 |
| B tail + index | 23.6k (-32%) | $0.103 (-28%) | 12.9 s | 14/14 |
| C index only | 16.5k (-53%) | $0.086 (-41%) | 13.3 s | 13/14 |
| D index + search | 17.9k (-49%) | $0.087 (-39%) | 16.1 s | 14/14 |

## Findings
- Savings are real but small in money: about $0.04 to $0.06 per question on this file. Variants with an index are slower by 4 to 7 seconds on average (B +4.2 s, C +4.5 s, D +7.3 s), and the slowdown comes from the questions that need an extra fetch turn: on the 6 questions B already holds in full it was as fast as A (9.3 s vs 9.7 s).
- The saving depends on the question mix. B costs $0.092 on questions it holds in full but $0.119 on questions it has to fetch (A: $0.144), and on one fetch-heavy question B cost the same as A. C and D stay near $0.08 to $0.09 because they start smaller.
- C had a silent false negative: it answered "there is no such open point" when the point was recorded in a late paragraph of the newest entry. Re-run twice: it failed once more (2 of 3 runs failed). Selective reading missed the paragraph and the answer sounded confident.
- No quality loss was observed for B and D, with one run per cell. 14/14 in 14 questions is also consistent with an error rate near 20%, so this is not proof. D's fix (search before saying "not recorded") worked in its one run on the question that C failed.
- Minor over-statements in answers that passed the automatic check (arms A and C): a standing decision presented as something said in that entry, a quotation that was a paraphrase, a date that was not in the log.

## Limits
- One file (the log), one model, 14 questions written by the assistant that had read the log, one run per cell (except 2 extra runs of C on 6 questions, whose cost is not comparable because the cache was warm).
- Question mix: 6 of the 14 questions target exactly the entries that B includes in full, which flatters B's average. Several questions contain easy search anchors (commit hashes, entry numbers), which helps C and D.
- Costs are cold-cache, single-question sessions. In a long session the whole context is re-read at the cheaper cached price on every turn, so per-session savings differ from these figures.
- Arms B, C and D carry tool definitions and a longer system prompt; A has no tools. Tool arms ran from a working directory that also held earlier results; no session was seen reading them, but isolation was not clean.
- Not tested: the other memory files, write cost (every update rewrites whole files), long sessions, other models.
- Token estimator calibration (used by `cost.mjs`): tokens = 0.29 x ASCII bytes + 0.48 x non-ASCII bytes; 0% error on 43 KB English and 78 KB mixed samples, up to 21% on ~4 KB samples.

## What shipped
Only visibility: the cost line and the suggestion. If tiering is ever built, use B plus D's rule (mandatory search before "not recorded"). Do not use C.

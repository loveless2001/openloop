# Jev article scope test — 2026-09-22

## Material and question

Use one fictional article to inspect whether the same writer-authored rubric behaves sensibly on a sentence, a paragraph, and a complete draft. This is an exploratory test with deliberately planted writing problems, not operational backup advice or a benchmark.

[Sample article](../fixtures/jev-scope-article.md) · [Exact editable rubric and cases](../fixtures/jev-scope-article.json)

The seven-paragraph article includes an unresolved reference in a selected sentence, a deliberately repetitive paragraph with an unsupported guarantee, and conflicting thirty-day/seven-day archive instructions. All material is synthetic. No personal document is submitted.

## Settings a writer would enter

- **Rubric title:** Volunteer newsletter: clear and supportable advice
- **Purpose:** Help a new volunteer follow the fictional newsletter team's backup routine, while keeping reliability claims supported and retention instructions consistent.
- **Audience:** New volunteer editors with ordinary folder-management skills and no specialist IT background.
- **Language hint:** English.
- **Provider:** TypeSafe Jev, requested model `jev-1.13.0`; server-only `TYPESAFE_API_KEY`, endpoint `https://api.typesafe.ai/v1/systemone`, timeout 30,000 ms.
- **Autocomplete:** off. Critic: local mock. Training trace capture: off.
- **Submission:** prepare and inspect each snapshot, then check the remote-destination confirmation and press **Evaluate**.

The app has `selection` and `document` scopes. A sentence or paragraph is a particular highlighted selection, not a separate scope enum. “Include nearby context” permits up to 1,000 Unicode code points before and after the target; the target remains unchanged. No hidden whole-article context is supplied to a selection.

### Exact criteria

**Clarity for new volunteers** — allowed scopes: selection, document.

Can a new volunteer understand what the target says or asks them to do, including what its references and essential terms mean?

| Level | Label        | Observable description                                                                                                                           |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Unclear      | Essential terms or references are unexplained, leaving the intended meaning or action unclear to a new volunteer.                                |
| 1     | Partly clear | The main meaning or action is understandable, but at least one term, reference, or instruction needs clarification.                              |
| 2     | Clear        | The meaning and any requested action are clear to a new volunteer; essential terms and references are understandable from the supplied material. |

**Conciseness** — allowed scopes: selection, document.

Does each sentence in the target add a distinct instruction, reason, example, or qualification rather than restating an existing point?

| Level | Label           | Observable description                                                                                      |
| ----- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| 0     | Repetitive      | The target mainly repeats a point without adding a distinct instruction, reason, example, or qualification. |
| 1     | Some repetition | The target adds useful content but also restates points without a distinct contribution.                    |
| 2     | Focused         | The target develops its points without restatement that adds no distinct content.                           |

**Support for reliability claims** — allowed scopes: selection, document.

Does the target support claims about preventing file loss with reasons or observations proportionate to their strength? Judge support in the supplied text, not external factual truth; instructions without a reliability claim are not applicable.

| Level | Label                   | Observable description                                                                                          |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0     | Unsupported             | The target makes a strong reliability claim without proportionate reasons or observations in the supplied text. |
| 1     | Partly supported        | Some reliability claims have relevant support, but an important claim overstates what that support establishes. |
| 2     | Supported and qualified | Reliability claims have relevant explicit support and their strength stays within the limits of that support.   |

**Consistent retention advice** — allowed scopes: document.

Does the complete article give compatible instructions about how long to retain the same dated archive copies?

| Level | Label       | Observable description                                                                                                   |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0     | Conflicting | The article gives incompatible retention instructions for the same dated archive copies without explaining an exception. |
| 1     | Ambiguous   | Retention instructions are incomplete or qualified unclearly, making their compatibility uncertain.                      |
| 2     | Consistent  | Retention instructions for the same dated archive copies agree, or differences have explicit, compatible conditions.     |

The document-only retention criterion must be skipped locally for sentence and paragraph selections. Each selection therefore sends three Score plus three assessability Choice questions; the complete article sends four of each.

## Plan recorded before model results

Assistant-authored pre-run hypotheses, not independent human labels or benchmark ground truth.

| Case             | User action                                     | Pre-run expectation                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sentence-none    | Highlight the sentence; Selected text only      | The referent of "that copy" is missing. Clarity may abstain for missing context or judge the ambiguity; the single sentence should not be called repetitive. Reliability support is not applicable to an instruction with no reliability claim.         |
| sentence-nearby  | Highlight the sentence; Include nearby context  | The preceding sentence identifies the dated archive copy. Clarity should become more assessable or improve; the target remains one sentence, and context must not be judged as target prose.                                                            |
| paragraph-none   | Highlight the paragraph; Selected text only     | The first two sentences repeat the value of a second copy. The never-lose-a-file guarantee has no proportionate support. Conciseness and support should be low or mixed; phrasing can still be understandable.                                          |
| paragraph-nearby | Highlight the paragraph; Include nearby context | The surrounding practice-session anecdote does not justify a guarantee of no file loss. Added context should not erase the target paragraph's repetition or unsupported certainty.                                                                      |
| whole-document   | Evaluate document                               | The thirty-day and seven-day retention instructions conflict. The document-only criterion should be assessed here and skipped locally for every selection. Other criteria need to account for both useful passages and the deliberately weak paragraph. |

**Sentence target:** “Keep that copy for thirty days.”

**Paragraph target:**

> Keeping a second copy is important because it gives the team another copy. An extra copy provides an additional copy, so the team has more than one copy. This routine guarantees that the team will never lose a file. Volunteers should therefore feel completely confident that every newsletter file is safe.

## Execution and observations

**Completed: 5/5 live requests, with five distinct request IDs and no retry, fallback, provider failure, or unattempted case.** Requested and returned model: `jev-1.13.0` for every run. Execution was 2026-09-22 10:41:19–10:41:30 UTC (17:41:19–17:41:30 Asia/Bangkok).

The browser imported the Markdown into a separate persisted app database, filled the blank-rubric form, saved revision 1, highlighted each exact target, chose the named context option, prepared each preview, checked the remote-submission confirmation, and clicked the evaluation panel's **Evaluate** button. All five inputs were preflighted before the first remote call. Outgoing request-body hashes were restricted to those preflighted inputs. The document stayed at version 0 throughout.

Two mock rehearsal attempts stopped on automation-selector errors before any inference; those selectors were corrected. The third mock rehearsal completed all five cases before this single live run. No application evaluation behavior was changed to obtain these results.

### Transport, payload, and scope evidence

| Case             | Request bytes | Score + Choice questions | Context before / after (characters) | Clipping | Duration (ms) | Input / output tokens |
| ---------------- | ------------: | ------------------------ | ----------------------------------- | -------- | ------------: | --------------------: |
| sentence-none    |         7,003 | 3 + 3                    | 0 / 0                               | None     |         1,256 |           1,654 / 403 |
| sentence-nearby  |         8,862 | 3 + 3                    | 853 / 1,000                         | after    |           443 |           2,013 / 403 |
| paragraph-none   |         7,277 | 3 + 3                    | 0 / 0                               | None     |           421 |           1,703 / 402 |
| paragraph-nearby |         8,934 | 3 + 3                    | 1,000 / 652                         | before   |           765 |           2,027 / 402 |
| whole-document   |        11,355 | 4 + 4                    | 0 / 0                               | None     |           714 |           2,480 / 529 |

The sentence contains 31 characters, the paragraph 305, and the canonical complete article 2,408 (411 whitespace-separated words in the Markdown file including its title). The whole-article request includes the heading and all seven paragraphs. Each request is below the 24,000-byte application cap. Context counts equal Unicode code-point counts here because the submitted English text is ASCII.

**Total usage:** 9,877 input tokens + 2,139 output tokens = 12,016 tokens. The five recorded run durations sum to 3,599 ms; the browser workflow also takes time. These are observations from one sequential run, not a latency benchmark. Monetary cost was not measured.

### What the app displayed

Parenthesized numbers are native fractional positions on that criterion's ordered 0–2 rubric. They are not quality percentages, aggregated article scores, or generated explanations. A label comes from the saved rubric. The display policy requires assessability probability at least 0.70 and a unique score level with probability at least 0.60; otherwise it abstains or shows a mixed assessment.

| Case             | Clarity                 | Conciseness            | Support for reliability claims | Retention consistency |
| ---------------- | ----------------------- | ---------------------- | ------------------------------ | --------------------- |
| sentence-none    | Assessability uncertain | Focused (1.96)         | Not applicable                 | Skipped locally       |
| sentence-nearby  | Mixed assessment (1.37) | Focused (1.92)         | Not applicable                 | Skipped locally       |
| paragraph-none   | Partly clear (1.12)     | Repetitive (0.09)      | Unsupported (0.19)             | Skipped locally       |
| paragraph-nearby | Mixed assessment (1.16) | Repetitive (0.03)      | Unsupported (0.04)             | Skipped locally       |
| whole-document   | Partly clear (0.99)     | Some repetition (0.94) | Unsupported (0.07)             | Conflicting (0.00)    |

### Interpretation against the recorded expectations

1. **The sentence is context-sensitive, with an unresolved result even after context.** Without context, clarity's assessability distribution was 0.60 assessable / 0.40 needs-context / 0.00 not-applicable. The app therefore showed **Assessability uncertain**, not a definite missing-context verdict. Nearby context increased assessability to 0.98. Clarity's score distribution remained split: 0.07 unclear / 0.49 partly clear / 0.44 clear, so the app showed **Mixed assessment**. This supports the narrower expectation that context enables assessment; it does not establish an unambiguous improvement to “Clear.”
2. **The weak paragraph received the intended low assessments.** With selected text only, the low-level probabilities were 0.91 for repetition and 0.82 for unsupported reliability claims. With nearby context they were 0.98 and 0.96. The surrounding anecdote did not make the guarantee well supported in this observation. Clarity changed from **Partly clear** to **Mixed assessment**, which is a useful caution against treating every context addition as a stable improvement. No prose explanation was returned, so the cause of that shift is not established.
3. **The whole-article result matched the planted retention conflict.** The retention criterion returned 1.00 probability on **Conflicting**. Its question explicitly asks about consistency of dated-copy retention, so this is a targeted assessment, not evidence that Jev independently discovered arbitrary issues. The whole article also received **Some repetition**, versus **Repetitive** for the isolated weak paragraph. That difference is consistent with the useful material elsewhere in the article, but the model did not provide a rationale.
4. **Scope gating worked as an application rule.** The document-only retention criterion was `incompatible_scope` for all four selections, generated no upstream questions, and had no fabricated score. This is integration evidence rather than model reasoning evidence.
5. **Applicability prevents misleading numeric labels.** The selected sentence makes no reliability claim. Both sentence runs marked the support criterion **Not applicable** (probabilities 0.88 and 0.82). Their raw diagnostic Scores were nevertheless high: 1.79 and 1.83, with high-level probabilities 0.89 and 0.88. Those scores were correctly excluded from the primary assessment.

There were 20 criterion slots: 13 assessed (including two mixed), two not-applicable, one uncertain-assessability, and four locally incompatible. Of the 16 returned Score answers, three were not used for an assessment. All returned legends matched the saved descriptions. The persisted session contains five evaluation runs, zero author-feedback rows, zero completion/critic model-run rows, and zero editorial issues. No author feedback was invented or submitted on the user's behalf.

## Implications for possible training data

This example makes the status gate concrete: exporting only a scalar Score would turn the sentence's non-applicable reliability judgment into a strong positive label. Preserve target scope, exact context, purpose/audience, rubric revision and descriptions, input hash, requested/returned model, assessability, full level distribution, and display-policy version together. Keep mixed and abstained outcomes explicit; do not silently turn them into a definite class or zero.

The recorded assessments are model-generated observations. The pre-run expectations were authored by the assistant, and the feedback arrays are empty; none are independently verified human ground truth. Sentence, paragraph, and article observations share one source and are not independent training/evaluation samples. If used in a later experiment, keep all views of this article together when defining held-out splits. No training or dataset promotion was performed.

## Artifacts and reproducibility

- [Exact application exports, five JSONL records](jev-article-scopes-2026-09-22/results.jsonl), including compiled requests and full validated distributions.
- [Criterion-level CSV, including unused diagnostic scores](jev-article-scopes-2026-09-22/criterion-results.csv).
- [Run manifest](jev-article-scopes-2026-09-22/manifest.json), with fixture/article/source-file hashes, base commit, and call count.
- [Actual outgoing-attempt hashes](jev-article-scopes-2026-09-22/attempts.jsonl).
- [Saved application rubric, revision 1](jev-article-scopes-2026-09-22/saved-rubric.json). The form generates criterion IDs; these saved IDs are authoritative for the run.
- UI captures: [sentence only](jev-article-scopes-2026-09-22/sentence-none.png), [sentence + context](jev-article-scopes-2026-09-22/sentence-nearby.png), [paragraph only](jev-article-scopes-2026-09-22/paragraph-none.png), [paragraph + context](jev-article-scopes-2026-09-22/paragraph-nearby.png), [whole article](jev-article-scopes-2026-09-22/whole-document.png).

The app was run from base commit `48ad2cc` plus the uncommitted J3 implementation; the manifest hashes identify the tested files. Raw previews, per-run exports, screenshots, and the retained SQLite session are also under `data/evaluations/jev-article-scopes/live-2026-09-22/`. Original JSONL exports and attempt records are archived byte-for-byte above. Credentials and authorization headers are absent.

Rehearse without remote calls, choosing a new output directory:

```bash
pnpm --filter @openloop/server exec node --import tsx ../../scripts/test-jev-article-scopes.ts --provider mock --output data/evaluations/jev-article-scopes/mock-new
```

A new live run uses `--provider typesafe --allow-remote` and a new output directory. It makes at most five paid calls, stops on the first failed run, and never retries automatically. The script uses port 5174 for its isolated browser session, shuts its servers down afterward, and retains the database. It does not modify the regular application's database or `.env`.

To inspect the existing saved results without submitting another evaluation, start the app against the retained test database:

```bash
DATABASE_URL=file:./data/evaluations/jev-article-scopes/live-2026-09-22/session.sqlite \
  COMPLETION_ENABLED=false COMPLETION_PROVIDER=mock CRITIC_PROVIDER=mock \
  EVALUATOR_PROVIDER=typesafe SERVER_PORT=8788 WEB_PORT=5174 pnpm dev
```

Open `http://127.0.0.1:5174`, then select the saved document once in that page's developer console:

```js
localStorage.setItem(
  "openloop.documentId",
  "fde9536f-4425-4d99-9115-7b2b55249042",
);
location.reload();
```

Open **Evaluation → Evaluation history**. Viewing history makes no model call. Alternatively, open the sample Markdown in the regular app and copy the documented rubric fields to reproduce the setup manually.

## Limits and stop point

This was one synthetic English article, one rubric revision, five correlated views, and one request per view. It did not measure repeatability, calibration, Vietnamese performance, broader writing usefulness, or training benefit. Provider confidence and a 1.00 displayed probability are not proof of correctness. No cost estimate is inferred from token usage. The planned five calls are complete; no follow-up sweep, retry, rewrite, or training run was started.

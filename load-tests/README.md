# Load Test Suite (k6) — NOT YET RUN

**No results in this document are real or estimated.** Every number below is
a *threshold* (a pass/fail bar you set before running), not a measurement.
This suite was prepared, not executed, because:
1. It needs external infrastructure (a machine to run k6 from, ideally not
   the same network as the target) that this session cannot provision.
2. Running it against the real production URL without the owner's explicit
   go-ahead risks disrupting the live app or tripping abuse/rate-limit
   systems unexpectedly — a decision the owner should make deliberately,
   ideally against a staging environment first.

## Prerequisites

```bash
# Install k6: https://k6.io/docs/get-started/installation/
# macOS:   brew install k6
# Linux:   see k6 docs (apt/yum repo)
# Windows: choco install k6   OR   winget install k6

# A dedicated test tenant + test accounts are required before running
# scenarios 2-8 (dashboard, exams, grading, admin ops) — do NOT point these
# at the real production tenant with real student accounts.
export BASE_URL="https://your-staging-url.example.com"
export TEST_TEACHER_EMAIL="..."
export TEST_TEACHER_PASSWORD="..."
export TEST_STUDENT_EMAIL="..."
export TEST_STUDENT_PASSWORD="..."
```

## Running one scenario

```bash
k6 run --env BASE_URL=$BASE_URL load-tests/01-auth.js
```

## Scenarios (each is its own file, run independently)

| # | File | Models |
|---|---|---|
| 1 | `01-auth.js` | Login burst |
| 2 | `02-student-dashboard.js` | Student dashboard load |
| 3 | `03-course-browsing.js` | Course/lesson listing |
| 4 | `04-exam-start.js` | Exam start burst (the highest-contention write path — many students starting the same exam at once) |
| 5 | `05-exam-questions.js` | Exam question retrieval (`get_student_exams`) |
| 6 | `06-exam-submit.js` | Exam submission burst |
| 7 | `07-teacher-grading.js` | Teacher grade review/export |
| 8 | `08-admin-ops.js` | Admin dashboard + user list operations |
| 9 | `09-ai-generation.js` | AI lesson/exam generation — **run this at LOW concurrency only**, it spends real (free-tier) AI provider quota every time |
| 10 | `10-proctoring-events.js` | Simulated proctoring event batches during an active exam |

## Suggested load stages (edit per scenario — do not run all at max together)

```js
export const options = {
  stages: [
    { duration: '1m', target: 100 },   // warm-up / stage A
    { duration: '2m', target: 100 },
    { duration: '1m', target: 1000 },  // stage B
    { duration: '2m', target: 1000 },
    { duration: '1m', target: 5000 },  // stage C — only after B passes thresholds
    { duration: '2m', target: 5000 },
    { duration: '1m', target: 10000 }, // stage D — only after C passes thresholds
    { duration: '2m', target: 10000 },
    { duration: '1m', target: 50000 }, // stage E — dedicated infra, not a laptop
    { duration: '2m', target: 50000 },
    { duration: '2m', target: 0 },     // ramp-down
  ],
};
```

**Methodology: find the FIRST bottleneck, don't just report a pass/fail at
one target number.** Run stage by stage; stop and diagnose the moment a
stage fails its thresholds rather than continuing to the next stage.

## Thresholds (set BEFORE running, not fitted to whatever result comes out)

```js
export const options = {
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],  // ms
    http_req_failed:   ['rate<0.01'],                 // <1% errors
    checks:            ['rate>0.99'],
  },
};
```

Adjust per-scenario — exam submission and AI generation are inherently
heavier than a dashboard read; give them looser p95/p99 budgets than
scenario 1/2/3.

## What to record once a real run happens (not before)

- p50 / p95 / p99 per scenario
- error rate and error *types* (timeout vs. 5xx vs. rate-limited 429 vs.
  connection refused — these point at different bottlenecks)
- Supabase dashboard: DB CPU%, active connections, slowest queries (via
  `pg_stat_statements` if enabled) during the run
- Vercel dashboard: function invocation count, duration, cold starts,
  concurrent execution count
- AI provider dashboard (Groq/Gemini console): request count vs. quota, 429s
- Which stage (A/B/C/D/E above) was the first to breach a threshold, and
  which specific metric breached it — that identifies the actual bottleneck,
  which may be the DB connection pool, a specific slow query, Vercel
  function concurrency limits, or the AI provider's own rate limit, and each
  implies a different fix.

Until this is actually run, `SCALABILITY_AUDIT.md`/`SCALING_PLAN.md` must
say `NOT YET MEASURED`, not a number.

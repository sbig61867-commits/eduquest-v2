// Scenario 4: Exam start burst — the highest-contention write path (many
// students hitting start_exam_attempt for the SAME exam within seconds of
// each other, e.g. when a teacher opens an exam window).
//
// REQUIRES a real staging test exam ID and a pool of test student session
// cookies/tokens — this script is a SCAFFOLD showing the request shape and
// checks; wire up real auth tokens per virtual user before running.
//
// Run: k6 run --env BASE_URL=$BASE_URL --env EXAM_ID=<uuid> --env AUTH_TOKEN=<jwt> load-tests/04-exam-start.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EXAM_ID = __ENV.EXAM_ID;
const AUTH_TOKEN = __ENV.AUTH_TOKEN; // Supabase session cookie/JWT for a test student

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 1000 },
    { duration: '1m', target: 1000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    // Exam start does a row lock + insert — expect it to be slower than a
    // read-only dashboard call under contention, but still bounded.
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    http_req_failed: ['rate<0.02'],
  },
};

export default function examStartScenario() {
  if (!EXAM_ID || !AUTH_TOKEN) {
    throw new Error('Set EXAM_ID and AUTH_TOKEN to a dedicated staging test exam + test student session — never a real production exam or real student.');
  }

  const res = http.post(
    `${BASE_URL}/api/exam/start`,
    JSON.stringify({ examId: EXAM_ID }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sb-access-token=${AUTH_TOKEN}`, // adjust to the app's real cookie name
      },
    }
  );

  check(res, {
    'status is 200 or already-submitted 409': (r) => r.status === 200 || r.status === 409,
    'no 5xx': (r) => r.status < 500,
  });

  sleep(1);
}

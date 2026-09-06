// Scenario 1: Login burst.
// Run: k6 run --env BASE_URL=$BASE_URL --env TEST_STUDENT_EMAIL=... --env TEST_STUDENT_PASSWORD=... load-tests/01-auth.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EMAIL = __ENV.TEST_STUDENT_EMAIL;
const PASSWORD = __ENV.TEST_STUDENT_PASSWORD;

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '1m', target: 1000 },
    { duration: '2m', target: 1000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  if (!EMAIL || !PASSWORD) {
    throw new Error('Set TEST_STUDENT_EMAIL / TEST_STUDENT_PASSWORD env vars to a dedicated staging/test account — never real user credentials.');
  }

  const loginPage = http.get(`${BASE_URL}/login`);
  check(loginPage, { 'login page loads': (r) => r.status === 200 });

  // Supabase auth happens client-side against the Supabase Auth REST API,
  // not a Next.js API route — this scenario measures the app's own login
  // PAGE load under concurrency. A true auth-throughput test should hit
  // Supabase's GoTrue endpoint directly with the anon key, which is a
  // separate, Supabase-side concern outside this app's control.

  sleep(1);
}

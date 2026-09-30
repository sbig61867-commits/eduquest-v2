import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// findBy*/waitFor default to 1 s. The exam-screen suites render the whole
// proctored exam page, and under the full parallel run (70+ files) one of them
// occasionally needed longer than that and failed on time alone, not on
// behaviour (seen 2026-09-30, 1 run in 3). Assertions are unchanged.
configure({ asyncUtilTimeout: 5000 })

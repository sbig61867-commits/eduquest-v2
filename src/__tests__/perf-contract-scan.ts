import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Static scan behind the Performance Contract ratchet (PERFORMANCE_CONTRACT.md).
 *
 * It walks every Supabase query chain — `<client>.from('<table>')…` — and every
 * `.rpc('<name>')` call in src/{app,components,lib,hooks}, and counts three
 * patterns per file:
 *
 *   starSelect     `.select('*…')` on a read. The shape of the row is then
 *                  whatever the table grows into, including columns no screen
 *                  needs (courses.source_text is 12 000 characters).
 *   unboundedRead  a read with none of .limit / .range / .single /
 *                  .maybeSingle / head-only count / .eq('id', …). It returns
 *                  every matching row, so its size grows with the institution.
 *   heavyFeedCall  a call to an RPC listed in HEAVY_FEEDS: feeds known to
 *                  return whole-institution or content-heavy result sets.
 *
 * What this cannot see (and the contract says so): a query assembled over
 * several statements (`let q = …; q = q.limit(5)`) is counted as unbounded,
 * and nothing here knows whether an RPC's SQL is bounded — that is what
 * supabase/tests/scale_baseline_check.sql measures.
 */

export const HEAVY_FEEDS: readonly string[] = [
  'get_student_exams', // returns every question of every exam (minus correct_answer)
  'get_admin_lessons', // every lesson of the tenant, no limit
  'get_admin_exams',   // every exam of the tenant, no limit
]

export type Rule = 'starSelect' | 'unboundedRead' | 'heavyFeedCall'
export type Counts = Record<Rule, Record<string, number>>

const ROOT = join(__dirname, '..')
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks']
const WRITES = new Set(['insert', 'update', 'upsert', 'delete'])
const BOUNDS = new Set(['limit', 'range', 'single', 'maybeSingle'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'messages') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

function stringArg(node: ts.Expression | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function isHeadOnly(options: ts.Expression | undefined): boolean {
  if (!options || !ts.isObjectLiteralExpression(options)) return false
  return options.properties.some(p =>
    ts.isPropertyAssignment(p) && p.name.getText() === 'head' && p.initializer.kind === ts.SyntaxKind.TrueKeyword)
}

interface Link { name: string; args: readonly ts.Expression[] }

/** The calls chained after `start` (itself included), outermost last. */
function chainFrom(start: ts.CallExpression): Link[] {
  const links: Link[] = []
  let node: ts.Node = start
  let call = start
  for (;;) {
    const access = call.expression as ts.PropertyAccessExpression
    links.push({ name: access.name.text, args: call.arguments })
    const parent = node.parent
    if (!parent || !ts.isPropertyAccessExpression(parent) || parent.expression !== node) break
    const grand = parent.parent
    if (!grand || !ts.isCallExpression(grand) || grand.expression !== parent) break
    node = grand
    call = grand
  }
  return links
}

export function scanSource(source: string, fileName = 'file.ts'): Record<Rule, number> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const counts: Record<Rule, number> = { starSelect: 0, unboundedRead: 0, heavyFeedCall: 0 }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression

      if (method === 'rpc' && HEAVY_FEEDS.includes(stringArg(node.arguments[0]) ?? '')) {
        counts.heavyFeedCall++
      }

      const table = stringArg(node.arguments[0])
      const isStorage = ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage'
      if (method === 'from' && table !== null && !isStorage) {
        const links = chainFrom(node)
        const select = links.find(l => l.name === 'select')
        const isWrite = links.some(l => WRITES.has(l.name))
        if (select && !isWrite) {
          const columns = stringArg(select.args[0]) ?? (select.args.length === 0 ? '*' : '')
          const headOnly = isHeadOnly(select.args[1])
          if (!headOnly && /(^|[\s,(])\*/.test(columns)) counts.starSelect++
          const byId = links.some(l => l.name === 'eq' && stringArg(l.args[0]) === 'id')
          const bounded = headOnly || byId || links.some(l => BOUNDS.has(l.name))
          if (!bounded) counts.unboundedRead++
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return counts
}

/** Counts per file (paths relative to src/, forward slashes), zero entries left out. */
export function scanRepo(): Counts {
  const result: Counts = { starSelect: {}, unboundedRead: {}, heavyFeedCall: {} }
  for (const abs of SCAN_DIRS.flatMap(d => walk(join(ROOT, d)))) {
    const file = relative(ROOT, abs).split(sep).join('/')
    const counts = scanSource(readFileSync(abs, 'utf8'), file)
    for (const rule of Object.keys(counts) as Rule[]) {
      if (counts[rule] > 0) result[rule][file] = counts[rule]
    }
  }
  return result
}

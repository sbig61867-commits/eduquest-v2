import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Markdown } from '@/components/shared/markdown'

describe('Markdown tables', () => {
  it('renders a | table | with its header row and drops the --- rule', () => {
    const { container } = render(<Markdown content={'Intro\n\n| Term | Value |\n|---|:---:|\n| **a** | 1 |\n| b | 2 |\n\nAfter'} />)
    expect([...container.querySelectorAll('th')].map(th => th.textContent)).toEqual(['Term', 'Value'])
    expect([...container.querySelectorAll('tbody tr')].map(tr => tr.textContent)).toEqual(['a1', 'b2'])
    expect(container.querySelector('td strong')?.textContent).toBe('a')
    expect(container.textContent).toContain('After')
  })
})

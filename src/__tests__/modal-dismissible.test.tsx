import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { Modal } from '@/components/ui/modal'

// A dialog showing a temporary password must not vanish on a stray click
// outside it or on Escape: the password cannot be shown again.

function setup(dismissible?: boolean) {
  const onClose = vi.fn()
  const { container, getByRole } = render(
    <Modal open onClose={onClose} title="t" dismissible={dismissible}><p>body</p></Modal>,
  )
  const backdrop = container.querySelector('.fixed.inset-0 > .fixed.inset-0') as HTMLElement
  return { onClose, backdrop, closeButton: getByRole('button') }
}

describe('Modal dismissible', () => {
  it('closes on a click outside and on Escape by default', () => {
    const { onClose, backdrop } = setup()
    fireEvent.click(backdrop)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('dismissible={false}: outside clicks and Escape do nothing; its own close button still works', () => {
    const { onClose, backdrop, closeButton } = setup(false)
    fireEvent.click(backdrop)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

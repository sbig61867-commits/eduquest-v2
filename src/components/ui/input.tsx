import { cn } from '@/lib/utils'
import { forwardRef, useId, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id: externalId, ...props }, ref) => {
    const generatedId = useId()
    const id = externalId ?? generatedId
    const errorId = `${id}-error`

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-fg">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'w-full px-4 py-2.5 rounded-md text-sm text-fg',
            'bg-elevated border transition-colors',
            'placeholder:text-fg-muted',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0',
            error
              ? 'border-error focus-visible:ring-error'
              : 'border-border hover:border-border-strong',
            className
          )}
          {...props}
        />
        {error && (
          <p id={errorId} role="alert" className="text-error text-xs">
            {error}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  NAME_PARTS,
  NAME_PART_MAX_LENGTH,
  NAME_PART_MIN_LETTERS,
  checkNameParts,
  type NamePart,
  type NameParts,
} from '@/lib/person-name'

// The four inputs of a student's name (src/lib/person-name.ts holds the rules).
// A field shows its error once it has been left, or once the parent sets
// `showErrors` after a submit attempt; the parent blocks the submit itself with
// `checkNameParts`, and the server checks again.

interface Props {
  value: NameParts
  onChange: (next: NameParts) => void
  /** Prefix for the input ids (several forms may share a page). */
  idPrefix: string
  showErrors?: boolean
  /** Under the legend: who is writing and why the real name matters. */
  hint?: string
  inputClassName?: string
  labelClassName?: string
  disabled?: boolean
}

export function FourPartNameFields({
  value, onChange, idPrefix, showErrors = false, hint, inputClassName, labelClassName, disabled,
}: Props) {
  const t = useTranslations('common.studentName')
  const [left, setLeft] = useState<Set<NamePart>>(new Set())
  const check = checkNameParts(value)
  const errors = check.ok ? {} : check.errors

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className={cn('block text-sm font-semibold text-slate-200', labelClassName)}>{t('legend')}</legend>
      {hint && <p className="text-xs text-slate-500 -mt-1">{hint}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {NAME_PARTS.map(part => {
          const id = `${idPrefix}-${part}`
          const error = (showErrors || left.has(part)) ? errors[part] : undefined
          return (
            <div key={part} className="space-y-1.5">
              <label htmlFor={id} className={cn('block text-sm font-medium text-slate-300', labelClassName)}>
                {t(`parts.${part}`)}
              </label>
              <input
                id={id}
                type="text"
                value={value[part]}
                onChange={e => onChange({ ...value, [part]: e.target.value })}
                onBlur={() => setLeft(prev => new Set(prev).add(part))}
                required
                maxLength={NAME_PART_MAX_LENGTH + 10}
                autoComplete={part === 'first' ? 'given-name' : part === 'family' ? 'family-name' : 'off'}
                placeholder={t(`placeholders.${part}`)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                className={cn(
                  'w-full px-4 py-2.5 rounded-lg bg-slate-800 border text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm',
                  inputClassName,
                  error ? 'border-red-500' : !inputClassName && 'border-slate-700',
                )}
              />
              {error && (
                <p id={`${id}-error`} className="text-red-400 text-xs">
                  {t(`errors.${error}`, { min: NAME_PART_MIN_LETTERS, max: NAME_PART_MAX_LENGTH })}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

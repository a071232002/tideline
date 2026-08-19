'use client'
import { useFormStatus } from 'react-dom'

/**
 * 表單送出的唯一回饋原語。所有表單都用它，不要各寫各的——
 * Ajar 就是因為各寫各的才變成「部分有部分沒有」（PLAN §3）。
 */
export function SubmitButton({
  children, pendingText, className, ...rest
}: { children: React.ReactNode; pendingText?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus()
  return (
    <button {...rest} type="submit" className={`btn${className ? ' ' + className : ''}`}
      disabled={pending} aria-busy={pending}>
      {pending ? (pendingText ?? '處理中…') : children}
    </button>
  )
}

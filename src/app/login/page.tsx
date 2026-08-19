'use client'
import { useActionState } from 'react'
import { signIn } from './actions'
import { SubmitButton } from '@/components/SubmitButton'

export default function LoginPage() {
  const [state, action] = useActionState(signIn, null as { error?: string } | null)

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <h1>Tideline</h1>
      <p className="sub">個人股票技術分析站</p>

      <form action={action} className="card" style={{ display: 'grid', gap: 10 }}>
        <label style={{ fontSize: '.85rem', color: 'var(--ink2)' }}>
          Email
          <input className="input" name="email" type="email" autoComplete="username"
            required style={{ width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ fontSize: '.85rem', color: 'var(--ink2)' }}>
          密碼
          <input className="input" name="password" type="password" autoComplete="current-password"
            required style={{ width: '100%', marginTop: 4 }} />
        </label>
        <SubmitButton pendingText="登入中…">登入</SubmitButton>
        {state?.error && <p className="err" role="alert">{state.error}</p>}
      </form>

      <p className="fine">這是個人站，帳號手動開立，沒有註冊入口。</p>
    </main>
  )
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { CookieOptions } from '@supabase/ssr'

type CookieList = { name: string; value: string; options?: CookieOptions }[]

/**
 * 不需要登入就能到達的路徑。
 *
 * `/api/cron` 在這裡，**不是因為它公開**，是因為它用另一套憑證：
 * Vercel Cron 帶的是 `Authorization: Bearer $CRON_SECRET`，不是使用者的
 * cookie。少了這一行，middleware 會把它 307 導去 `/login`——排程每天準時
 * 打進來、每天拿到一個轉址、資料一天都沒更新，而 cron 的紀錄上是「有回應」。
 *
 * 那個 route handler 自己會逐字比對憑證，而且**沒設 `CRON_SECRET` 就一律拒絕**。
 */
const PUBLIC_PATHS = ['/login', '/auth', '/api/cron']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: CookieList) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // getClaims 在本機驗簽，不必每次往 Auth 伺服器跑一趟
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims)

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }
  if (signedIn && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

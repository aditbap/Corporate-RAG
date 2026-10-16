import Link from 'next/link'
import { ThemeToggle } from '@/components/ThemeToggle'
import { login, register } from './actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function LoginPage(props: { searchParams: Promise<{ message?: string; callbackUrl?: string }> }) {
  const searchParams = await props.searchParams;

  return (
    <div className="relative flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950 p-4">
      <ThemeToggle className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in with your organization account to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          {searchParams?.message && (
            <p className="text-sm font-medium text-destructive mb-4 text-center">
              {searchParams.message}
            </p>
          )}
          <form action={login}>
            <input type="hidden" name="callbackUrl" value={searchParams?.callbackUrl ?? ''} />
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
          <form action={register} className="mt-2">
            <input type="hidden" name="callbackUrl" value={searchParams?.callbackUrl ?? ''} />
            <Button type="submit" variant="outline" className="w-full">
              Create account
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/" className="underline underline-offset-4 hover:text-foreground">Continue as guest</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

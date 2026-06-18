import { Suspense } from 'react'
import AuthForm from './auth-form'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Ringmark</h1>
          <p className="text-sm text-bark mt-1">Sign in to your workshop</p>
        </div>
        <Suspense>
          <AuthForm />
        </Suspense>
      </div>
    </div>
  )
}

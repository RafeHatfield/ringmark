import { Suspense } from 'react'
import SignupForm from './signup-form'

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Ringmark</h1>
          <p className="text-sm text-bark mt-1">Create your workshop</p>
        </div>
        <Suspense>
          <SignupForm />
        </Suspense>
      </div>
    </div>
  )
}

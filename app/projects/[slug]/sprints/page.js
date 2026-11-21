'use client'

// Generated: renders views/projects/[slug]/sprints.js with the signed-in user, as pages/_app did.
// Suspense is required around useSearchParams (lib/router-compat.js).
import { Suspense } from 'react'
import View from '../../../../views/projects/[slug]/sprints.js'
import { useCurrentUser } from '../../../../components/AppShell.js'

export default function Page() {
  const currentUser = useCurrentUser()
  return (
    <Suspense fallback={null}>
      <View currentUser={currentUser} />
    </Suspense>
  )
}

import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { GuestChat } from '@/components/GuestChat'

export default async function Home() {
  // Signed-in users go straight to their workspace; everyone else gets the public guest chat.
  const session = await auth()
  if (session && !session.error) redirect('/dashboard/chat')
  return <GuestChat />
}

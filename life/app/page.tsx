import { redirect } from 'next/navigation'

// the home row of portraits comes next; for now the site opens on the most recent life
export default function Home() {
  redirect('/live')
}

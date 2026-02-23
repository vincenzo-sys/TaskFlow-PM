import { redirect } from 'next/navigation';

export default function Home() {
  // Root page redirects to today view (or login if unauthenticated)
  redirect('/today');
}

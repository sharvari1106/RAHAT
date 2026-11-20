import { redirect } from 'next/navigation';

// middleware.js sends logged-in users to their role's home page and everyone else to /help
export default function Home() {
  redirect('/help');
}

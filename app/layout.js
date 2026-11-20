import './globals.css';

export const metadata = {
  title: 'RAHAT - disaster relief coordination',
  description: 'SOS triage, rescue team dispatch, relief camps, supplies and missing persons',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

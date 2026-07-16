import { AppBar } from './app-bar';

/** App bar + a content column that stays narrow on mobile and widens into a
 *  comfortable, centered desktop column. One place, so the four pages match. */
export function PageShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <AppBar title={title} action={action} />
      <main className="mx-auto max-w-xl px-4 pt-4 lg:max-w-3xl lg:px-8 lg:pt-6">{children}</main>
    </>
  );
}

/** Re-mounts on every navigation inside the app so each page plays its entrance animation. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}

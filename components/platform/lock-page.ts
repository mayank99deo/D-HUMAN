// The page behind a modal (Ask, the Say card) stops scrolling: the touch frame and, on
// laptops, the page itself. Returns the undo. Browser-only.
export function lockPage() {
  const shell = document.getElementById("app-shell");
  const root = document.documentElement;
  const before = { shell: shell?.style.overflow ?? "", root: root.style.overflow };
  if (shell) shell.style.overflow = "hidden";
  root.style.overflow = "hidden";
  return () => {
    if (shell) shell.style.overflow = before.shell;
    root.style.overflow = before.root;
  };
}

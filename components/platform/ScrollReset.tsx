"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";

// On phones and tablets the app's screens scroll inside #app-shell rather than the
// page (see the app layout). Every move to another screen starts that frame at the
// top. It runs before Next.js looks at scroll (it sits ahead of the page in the
// layout), so Next finds the new screen's top already in view and leaves it there.
// On laptops #app-shell doesn't scroll, so this does nothing and the page scrolls as usual.
export function ScrollReset() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const shell = document.getElementById("app-shell");
    if (shell && shell.scrollTop !== 0) shell.scrollTop = 0;
  }, [pathname]);
  return null;
}

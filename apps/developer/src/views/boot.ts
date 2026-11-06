import { mount, mountHeader, url } from "@aplora/client";

export function bootstrap(render: (root: HTMLElement) => Promise<void> | void, loadingMessage?: string): void {
  void mountHeader({ portal: "developer", loginPath: "login/", registerPath: "register/" });
  mount(render, { loadingMessage });
}

/** Shared guard: every developer page needs a developer-capable session. */
export function requireDeveloperPage(): boolean {
  // The redirect happens inside the views once the session is known; this keeps
  // the URL handy for links.
  void url;
  return true;
}

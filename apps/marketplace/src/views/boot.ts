import { mount, mountHeader } from "@aplora/client";

/**
 * Every page boots the same way: fill the account area, then render the view.
 * The header request and the page request run in parallel.
 */
export function bootstrap(render: (root: HTMLElement) => Promise<void> | void, loadingMessage?: string): void {
  void mountHeader({ portal: "marketplace", loginPath: "login/", registerPath: "register/" });
  mount(render, { loadingMessage });
}

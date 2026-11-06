import { mount, mountHeader } from "@aplora/client";

export function bootstrap(render: (root: HTMLElement) => Promise<void> | void, loadingMessage?: string): void {
  void mountHeader({ portal: "admin", loginPath: "login/", registerPath: "login/" });
  mount(render, { loadingMessage });
}

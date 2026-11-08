import {
  ErrorBoundaryHandler,
  type ErrorComponent,
} from "next/dist/client/components/error-boundary";
import {
  type ComponentType,
  type FunctionComponent,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { recoveryCopy } from "../ui/recovery-copy";
import ErrorPage from "./error";
import GlobalError from "./global-error";

// AUD-4 F-11: the app and global error boundaries take `retry` from their props. The installed
// Next.js error boundary (next/dist/client/components/error-boundary.js) renders the error
// component with { error, reset, retry }; the root boundary that wraps global-error.tsx uses the
// same handler. These tests render each component through that handler, so they fail if Next
// stops passing the function the "Try again" button calls.

type ElementProps = { children?: ReactNode; onClick?: unknown };
type BoundaryProps = { error: unknown; reset: () => void; retry: () => void };

function retryElements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => retryElements(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const own = node.props.children === recoveryCopy.retry ? [node] : [];
  return [...own, ...retryElements(node.props.children)];
}

// Follows function components (the design-system Button) down to the host <button>.
function hostElement(element: ReactElement<ElementProps>): ReactElement<ElementProps> {
  if (typeof element.type !== "function") return element;
  const rendered = (element.type as FunctionComponent<ElementProps>)(element.props);
  if (!isValidElement<ElementProps>(rendered)) throw new Error("the button rendered no element");
  return hostElement(rendered);
}

function renderInNextBoundary(component: ComponentType<never>) {
  const handler = new ErrorBoundaryHandler({
    pathname: "/today",
    errorComponent: component as unknown as ErrorComponent,
  });
  handler.state = {
    error: { thrownValue: new Error("render failed") },
    previousPathname: "/today",
  };
  const refresh = vi.fn();
  handler.context = { refresh } as unknown as typeof handler.context;
  const setState = vi.spyOn(handler, "setState").mockImplementation(() => {});

  const fragment = handler.render();
  if (!isValidElement<{ children: ReactNode[] }>(fragment)) throw new Error("no fallback rendered");
  const fallback = fragment.props.children.find(
    (child) => isValidElement(child) && child.type === component,
  );
  if (!isValidElement<BoundaryProps>(fallback)) throw new Error("no error component rendered");
  const props = fallback.props;
  const tree = (component as unknown as (props: BoundaryProps) => ReactNode)(props);
  const buttons = retryElements(tree);
  return { handler, props, buttons, refresh, setState };
}

describe.each([
  ["app error boundary (error.tsx)", ErrorPage],
  ["global error boundary (global-error.tsx)", GlobalError],
] as const)("Try again in the %s", (_name, component) => {
  it("gets reset and retry functions from the installed Next.js error boundary", () => {
    const { handler, props } = renderInNextBoundary(component);
    expect(props.error).toBeInstanceOf(Error);
    expect(props.reset).toBe(handler.reset);
    expect(props.retry).toBe(handler.retry);
    expect(typeof props.retry).toBe("function");
  });

  it("has one Try again button bound to a function Next.js passes", () => {
    const { props, buttons } = renderInNextBoundary(component);
    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    if (!button) throw new Error("no Try again button");
    const onClick = hostElement(button).props.onClick;
    expect(typeof onClick).toBe("function");
    expect([props.retry, props.reset]).toContain(onClick);
  });

  it("clears the boundary's error when Try again is clicked", () => {
    const { buttons, setState } = renderInNextBoundary(component);
    const [button] = buttons;
    if (!button) throw new Error("no Try again button");
    const onClick = hostElement(button).props.onClick as () => void;
    onClick();
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith({ error: null });
  });

  it("refreshes the router through Next.js's retry when Try again is clicked", () => {
    const { buttons, refresh } = renderInNextBoundary(component);
    const [button] = buttons;
    if (!button) throw new Error("no Try again button");
    (hostElement(button).props.onClick as () => void)();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

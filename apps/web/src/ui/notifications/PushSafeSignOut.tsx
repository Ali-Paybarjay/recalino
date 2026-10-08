"use client";
import { useRef, useState } from "react";
import { Button } from "../components/Button";
import { devicePushSubscription } from "./push";

/** Include this device's endpoint so server sign-out revokes its recipient before ending auth. */
export function PushSafeSignOut({
  className,
  buttonClassName,
  label,
}: {
  className?: string;
  buttonClassName?: string;
  label: string;
}) {
  const endpoint = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  return (
    <form
      method="post"
      action="/auth/sign-out"
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        if (working) return;
        const form = event.currentTarget;
        setWorking(true);
        const subscription = await devicePushSubscription().catch(() => null);
        if (endpoint.current) endpoint.current.value = subscription?.endpoint ?? "";
        // The server removes the durable recipient even when the browser's unsubscribe fails.
        if (subscription) await subscription.unsubscribe().catch(() => false);
        form.submit();
      }}
    >
      <input type="hidden" name="pushEndpoint" ref={endpoint} />
      <Button type="submit" className={buttonClassName} loading={working}>
        {label}
      </Button>
    </form>
  );
}
